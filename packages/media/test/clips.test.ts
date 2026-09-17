import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createClipRunner, executeClipWorkflow } from "../src/clip-runner";
import { createClipService } from "../src/clip-service";
import { createMediaService } from "../src/service";
import type { MediaStorage } from "../src/storage";
import { inspectVideo } from "../src/video";

function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Missing test fixture value");
	return value;
}
const fixture = (name: string) =>
	new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const objects = new Map<string, Uint8Array<ArrayBuffer>>();
const storage: MediaStorage & { delete: (key: string) => Promise<void> } = {
	put: async (key, bytes) => {
		objects.set(key, bytes);
	},
	get: async (key) => {
		const bytes = objects.get(key);
		return bytes
			? { body: required(new Response(bytes).body), bytes: bytes.length }
			: null;
	},
	delete: async (key) => {
		objects.delete(key);
	},
};
const steps = {
	do: async <T>(_: string, _options: unknown, fn: () => Promise<T>) => fn(),
};
let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let graph: CanvasDocument;
let video = createCanvasNode("video", { x: 0, y: 0 });
let speech = createCanvasNode("speech", { x: 0, y: 0 });
const dispatch = vi.fn(async (_id: string) => {});
const render = vi.fn(async () => fixture("narrated-clip.mp4"));
const media = () => createMediaService(db.media, db.projects, storage);
const projects = () =>
	createProjectService(db.projects, {
		appUrl: "https://example.test",
		email: {
			isConfigured: () => false,
			send: async () => ({ messageId: null }),
		},
	});
const service = () =>
	createClipService(db.clips, db.store, db.media, projects(), {
		configured: async () => true,
		dispatch,
	});
const runner = () => createClipRunner(db.clips, media(), storage, render);
const request = async () => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId: video.id,
	inputHash: (await service().preview("owner", { projectId, nodeId: video.id }))
		.inputHash,
});
beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	objects.clear();
	render.mockClear();
	dispatch.mockClear();
	video = createCanvasNode("video", { x: 0, y: 0 });
	speech = createCanvasNode("speech", { x: 200, y: 0 });
	const v = await media().upload("owner", projectId, {
		name: "source.mp4",
		mimeType: "video/mp4",
		bytes: fixture("clip.mp4"),
	});
	const a = await media().upload("owner", projectId, {
		name: "speech.mp3",
		mimeType: "audio/mpeg",
		bytes: fixture("tone.mp3"),
	});
	video.data.mediaSource = "project";
	video.data.assetId = v.id;
	video.data.clipSettings = {
		narrationStartMs: 1000,
		narrationVolume: 1,
		videoVolume: 0,
	};
	speech.data.mediaSource = "project";
	speech.data.assetId = a.id;
	graph = {
		version: 1,
		nodes: [video, speech],
		edges: [
			{
				id: crypto.randomUUID(),
				source: speech.id,
				target: video.id,
				sourceHandle: "output",
				targetHandle: "audio",
			},
		],
	};
	await db.setGraph(projectId, graph);
});
it("creates a private narrated MP4, preserves inputs, and does not debit AI credits", async () => {
	await db.grant("owner", 10);
	const input = await request();
	await service().start("owner", input);
	await executeClipWorkflow(input.id, runner(), steps);
	const result = await db.clips.get(input.id);
	expect(result?.status).toBe("succeeded");
	expect(render).toHaveBeenCalledTimes(1);
	expect(await db.store.balance("owner")).toBe(10);
	const files = await media().list("viewer", projectId);
	expect(files).toHaveLength(3);
	const output = await media().read(
		"viewer",
		projectId,
		required(result?.assetId),
	);
	expect(
		inspectVideo(
			new Uint8Array(await new Response(output.object.body).arrayBuffer()),
			"required",
		).durationMs,
	).toBe(5000);
	expect(objects.has(`clip-receipts/${input.id}.mp4`)).toBe(false);
	expect((await service().list("viewer", { projectId })).results).toHaveLength(
		1,
	);
});
it("binds retries to the actor and reviewed inputs while replaying the same job safely", async () => {
	const input = await request();
	await service().start("owner", input);
	await service().start("owner", input);
	expect(await db.clips.pending()).toHaveLength(1);
	await expect(service().start("editor", input)).rejects.toMatchObject({
		code: "CONFLICT",
	});
	await expect(
		service().start("owner", { ...input, inputHash: "0".repeat(64) }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(
		await db.clips.claim({
			...input,
			userId: "owner",
			plan: required(await db.clips.get(input.id)).plan,
			inputHash: "0".repeat(64),
		}),
	).toBe("CONFLICT");
});
it("rejects viewers, outsiders, missing sources, wrong media and stale previews", async () => {
	const input = await request();
	await expect(service().start("viewer", input)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(service().list("outsider", { projectId })).rejects.toThrow();
	required(video.data.clipSettings).narrationVolume = 0.5;
	await db.setGraph(projectId, graph);
	await expect(service().start("owner", input)).rejects.toMatchObject({
		code: "CONFLICT",
	});
	video.data.assetId = speech.data.assetId;
	await db.setGraph(projectId, graph);
	await expect(service().preview("owner", input)).rejects.toThrow(
		"video first",
	);
	graph.edges = [];
	await db.setGraph(projectId, graph);
	await expect(service().preview("owner", input)).rejects.toThrow(
		"Connect a Speech",
	);
	expect(dispatch).not.toHaveBeenCalled();
});
it("rejects a narration starting at or after the end and missing renderer before creating jobs", async () => {
	required(video.data.clipSettings).narrationStartMs = 5000;
	await db.setGraph(projectId, graph);
	await expect(
		service().preview("owner", { projectId, nodeId: video.id }),
	).rejects.toThrow("before the video ends");
	required(video.data.clipSettings).narrationStartMs = 0;
	await db.setGraph(projectId, graph);
	const input = await request();
	const disabled = createClipService(db.clips, db.store, db.media, projects(), {
		configured: async () => false,
		dispatch,
	});
	await expect(disabled.start("owner", input)).rejects.toMatchObject({
		code: "SERVICE_UNAVAILABLE",
	});
	expect(await db.clips.pending()).toHaveLength(0);
});
it("renders a frozen plan after canvas changes and survives receipt retries without rendering twice", async () => {
	const input = await request();
	await service().start("owner", input);
	required(video.data.clipSettings).narrationStartMs = 2000;
	await db.setGraph(projectId, graph);
	const r = runner();
	await r.render(input.id);
	await r.render(input.id);
	expect(render).toHaveBeenCalledTimes(1);
	expect((await db.clips.get(input.id))?.plan.narrationStartMs).toBe(1000);
	await r.publish(input.id);
	await r.publish(input.id);
	expect(await media().list("owner", projectId)).toHaveLength(3);
});
it("keeps an accepted job recoverable after dispatch failure and limits concurrent work", async () => {
	dispatch.mockRejectedValueOnce(new Error("Offline"));
	const input = await request();
	await service().start("owner", input);
	expect((await db.clips.pending()).map((r) => r.id)).toEqual([input.id]);
	await expect(
		service().start("owner", { ...input, id: crypto.randomUUID() }),
	).rejects.toThrow("active clip");
	await db.expireClip(input.id);
	await db.clips.expire();
	expect((await db.clips.get(input.id))?.status).toBe("failed");
	await service().start("owner", { ...input, id: crypto.randomUUID() });
});
it("does not publish after editor access is revoked or the job expires", async () => {
	let input = await request();
	await service().start("editor", input);
	await runner().render(input.id);
	await db.revoke("editor");
	await executeClipWorkflow(input.id, runner(), steps);
	expect((await db.clips.get(input.id))?.status).toBe("failed");
	expect(await media().list("owner", projectId)).toHaveLength(2);
	input = await request();
	await service().start("owner", input);
	await db.expireClip(input.id);
	await executeClipWorkflow(input.id, runner(), steps);
	expect((await db.clips.get(input.id))?.status).toBe("failed");
});
it("rejects truncated audio samples and keeps failed rendered files private", async () => {
	expect(() => inspectVideo(fixture("narrated-clip.mp4"))).toThrow();
	expect(() =>
		inspectVideo(fixture("narrated-clip.mp4").slice(0, -5), "required"),
	).toThrow();
	await expect(
		media().stageClip("owner", projectId, {
			bytes: fixture("clip.mp4"),
			mimeType: "video/mp4",
			name: "bad.mp4",
		}),
	).rejects.toMatchObject({ status: 415 });
	const input = await request();
	await service().start("owner", input);
	render.mockRejectedValueOnce(new Error("Renderer stopped"));
	await executeClipWorkflow(input.id, runner(), steps);
	expect((await db.clips.get(input.id))?.status).toBe("failed");
	expect(await media().list("owner", projectId)).toHaveLength(2);
});
