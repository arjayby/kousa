import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaHandler } from "@kousa/media/http";
import { createMediaService } from "@kousa/media/service";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { defaultVideoModel } from "../src/contracts";
import {
	buildImagePrompt,
	generationInputHash,
	videoInputSnapshot,
} from "../src/input";
import type { VideoProvider } from "../src/providers";
import { createGenerationRunner } from "../src/runner";
import { createGenerationService } from "../src/service";
import { executeGenerationWorkflow } from "../src/workflow";
import { inlineSteps, memoryArtifacts, unavailableImage } from "./helpers";

const video = new Uint8Array(
	readFileSync(new URL("../../media/test/fixtures/clip.mp4", import.meta.url)),
);
let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let node = createCanvasNode("video", { x: 0, y: 0 });
let graph: CanvasDocument;
let media: ReturnType<typeof createMediaService>;
let artifacts = memoryArtifacts();
const start = vi.fn<VideoProvider["start"]>();
const poll = vi.fn<VideoProvider["poll"]>();
const objects = new Map<string, Uint8Array<ArrayBuffer>>();
const runner = () =>
	createGenerationRunner(
		db.store,
		artifacts,
		{
			configured: false,
			generate: async () => {
				throw new Error("Unexpected text call");
			},
		},
		unavailableImage,
		media,
		undefined,
		{ configured: true, start, poll },
	);
const service = () =>
	createGenerationService(
		db.store,
		createProjectService(db.projects, {
			appUrl: "https://kousa.app",
			email: {
				isConfigured: () => false,
				send: async () => ({ messageId: null }),
			},
		}),
		{
			textConfigured: false,
			imageConfigured: false,
			videoConfigured: true,
			dispatch: async () => {},
		},
	);
const request = async () => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId: node.id,
	inputHash: await generationInputHash(graph, node.id),
});
async function finish(id: string) {
	await executeGenerationWorkflow(id, runner(), inlineSteps);
	return db.store.get(id);
}
const http = (
	actor: string | null,
	assetId: string,
	method = "GET",
	range?: string,
) =>
	createMediaHandler({ actor: async () => actor, service: () => media })(
		new Request("https://kousa.app/media", {
			method,
			headers: range ? { range } : {},
		}),
		{ projectId, assetId },
	);

beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	node = createCanvasNode("video", { x: 0, y: 0 });
	node.data.content = "Welcome to Kousa.";
	node.data.voiceDirection = "Warm and calm";
	graph = { version: 1, nodes: [node], edges: [] };
	await db.setGraph(projectId, graph);
	await db.grant("owner", 50);
	objects.clear();
	artifacts = memoryArtifacts();
	start.mockReset().mockResolvedValue({ job: "operation-1" });
	poll
		.mockReset()
		.mockResolvedValue({
			status: "succeeded",
			bytes: video,
			mimeType: "video/mp4",
		});
	media = createMediaService(db.media, db.projects, {
		put: async (key, bytes) => {
			objects.set(key, bytes);
		},
		get: async (key, range) => {
			const full = objects.get(key);
			if (!full) return null;
			const bytes = range
				? full.slice(range.offset, range.offset + range.length)
				: full;
			return {
				bytes: bytes.length,
				body: new Response(bytes).body as ReadableStream,
			};
		},
	});
});
it("persists a single submission, resumes polling after restart, then publishes and charges once", async () => {
	const input = await request();
	expect(await service().generate("owner", input)).toMatchObject({
		status: "queued",
		kind: "video",
		credits: 10,
	});
	node.data.content = "Edited while queued";
	node.data.duration = 10;
	await db.setGraph(projectId, graph);
	expect(await runner().generate(input.id)).toBe("pending");
	expect(start).toHaveBeenCalledWith({
		id: input.id,
		modelId: defaultVideoModel,
		prompt: "Welcome to Kousa.",
		aspectRatio: "16:9",
		duration: 5,
	});
	expect((await db.store.get(input.id))?.providerOperation).toEqual({
		job: "operation-1",
	});
	poll.mockResolvedValueOnce({ status: "pending" });
	expect(await runner().generate(input.id)).toBe("pending");
	expect(await runner().generate(input.id)).toBe(true);
	expect(await runner().generate(input.id)).toBe(true);
	const prepared = await runner().prepare(input.id);
	expect(await media.list("viewer", projectId)).toEqual([]);
	await runner().finalize(input.id, prepared);
	await runner().finalize(input.id, prepared);
	expect(start).toHaveBeenCalledTimes(1);
	expect(poll).toHaveBeenCalledTimes(2);
	expect(await db.store.balance("owner")).toBe(40);
	const run = await service().generate("owner", input);
	expect(run).not.toHaveProperty("providerOperation");
	expect((await service().list("viewer", { projectId })).videoResults).toEqual([
		run,
	]);
	const [asset] = await media.list("viewer", projectId);
	if (!asset) throw new Error("Missing video");
	expect(asset).toMatchObject({
		mimeType: "video/mp4",
		width: 160,
		height: 90,
		durationMs: 5000,
	});
	expect([...objects.keys()][0]).toContain(`/videos/${asset.id}`);
	const response = await http("viewer", asset.id);
	expect(response.headers.get("content-type")).toBe("video/mp4");
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(video);
	const range = await http("viewer", asset.id, "GET", "bytes=5-19");
	expect(range.status).toBe(206);
	expect(range.headers.get("content-range")).toBe(`bytes 5-19/${video.length}`);
	expect(new Uint8Array(await range.arrayBuffer())).toEqual(video.slice(5, 20));
	expect(
		(await http("viewer", asset.id, "HEAD")).headers.get("content-length"),
	).toBe(String(video.length));
	expect((await http("outsider", asset.id)).status).toBe(404);
	expect((await http(null, asset.id)).status).toBe(401);
});
it("charges the editor 20 credits for 10 seconds and sleeps durably between polls", async () => {
	node.data.duration = 10;
	await db.setGraph(projectId, graph);
	await db.grant("editor", 20);
	poll
		.mockResolvedValueOnce({ status: "pending" })
		.mockResolvedValue({
			status: "succeeded",
			bytes: new Uint8Array(
				readFileSync(
					new URL("../../media/test/fixtures/clip-10s.mp4", import.meta.url),
				),
			),
			mimeType: "video/mp4",
		});
	const input = await request();
	await service().generate("editor", input);
	const sleep = vi.fn(async () => {});
	await executeGenerationWorkflow(input.id, runner(), {
		...inlineSteps,
		sleep,
	});
	expect(sleep).toHaveBeenCalledTimes(2);
	expect(sleep).toHaveBeenCalledWith("wait-for-video-0", 20000);
	expect((await db.store.get(input.id))?.status).toBe("succeeded");
	expect(await db.store.balance("editor")).toBe(0);
	expect(await db.store.balance("owner")).toBe(50);
});
it("retries status reads without resubmitting and resumes a receipt after storage failure", async () => {
	const input = await request();
	await service().generate("owner", input);
	await runner().generate(input.id);
	poll.mockRejectedValueOnce(new Error("Status transport lost"));
	await expect(runner().generate(input.id)).rejects.toThrow("transport");
	const originalPut = artifacts.put;
	artifacts.put = vi
		.fn()
		.mockRejectedValueOnce(new Error("R2 unavailable"))
		.mockImplementation(originalPut);
	await expect(runner().generate(input.id)).rejects.toThrow("R2 unavailable");
	expect(await runner().generate(input.id)).toBe(true);
	await finish(input.id);
	expect(start).toHaveBeenCalledTimes(1);
	expect(await db.store.balance("owner")).toBe(40);
});
it("does not resubmit when the operation acknowledgement is lost", async () => {
	const input = await request();
	await service().generate("owner", input);
	const saved = db.store.saveOperation;
	const spy = vi
		.spyOn(db.store, "saveOperation")
		.mockImplementation(async (...args) => {
			await saved(...args);
			throw new Error("Lost acknowledgement");
		});
	try {
		await expect(runner().generate(input.id)).rejects.toThrow(
			"operation storage",
		);
	} finally {
		spy.mockRestore();
	}
	await finish(input.id);
	expect(start).toHaveBeenCalledTimes(1);
	expect((await db.store.get(input.id))?.status).toBe("succeeded");
});
it("releases an ambiguous submission without automatically buying another clip", async () => {
	const input = await request();
	await service().generate("owner", input);
	start.mockRejectedValue(new Error("Lost response"));
	await finish(input.id);
	await finish(input.id);
	expect(start).toHaveBeenCalledTimes(1);
	expect(poll).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(50);
});
it.each(["failed", "pending"] as const)(
	"releases credits for a provider that stays %s",
	async (status) => {
		const input = await request();
		await service().generate("owner", input);
		poll.mockResolvedValue({ status });
		expect((await finish(input.id))?.status).toBe("failed");
		expect(await db.store.balance("owner")).toBe(50);
		expect(start).toHaveBeenCalledTimes(1);
		expect(await media.list("owner", projectId)).toEqual([]);
	},
);
it("requires editor access and rejects unsupported media inputs before reserving credits", async () => {
	await expect(
		service().generate("viewer", await request()),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	const source = createCanvasNode("image", { x: 0, y: 0 });
	graph.nodes.push(source);
	graph.edges.push({
		id: crypto.randomUUID(),
		source: source.id,
		target: node.id,
		sourceHandle: "output",
		targetHandle: "image",
	});
	await db.setGraph(projectId, graph);
	expect(() => videoInputSnapshot(graph, node.id)).toThrow("text prompts only");
	expect(start).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(50);
});
it("does not publish or charge after editor access is revoked or the run expires", async () => {
	await db.grant("editor", 10);
	let input = await request();
	await service().generate("editor", input);
	await runner().generate(input.id);
	await db.revoke("editor");
	expect((await finish(input.id))?.status).toBe("failed");
	expect(await db.store.balance("editor")).toBe(10);
	input = await request();
	await service().generate("owner", input);
	await runner().generate(input.id);
	await db.expire(input.id);
	await finish(input.id);
	expect(await db.store.balance("owner")).toBe(50);
	expect(await media.list("owner", projectId)).toEqual([]);
});
it("keeps the last successful video when a later result is invalid", async () => {
	let input = await request();
	await service().generate("owner", input);
	const previous = await finish(input.id);
	input = await request();
	await service().generate("owner", input);
	poll.mockResolvedValue({
		status: "succeeded",
		bytes: video.slice(0, -50),
		mimeType: "video/mp4",
	});
	expect((await finish(input.id))?.status).toBe("failed");
	expect(await db.store.balance("owner")).toBe(40);
	expect(
		(await service().list("viewer", { projectId })).videoResults[0]?.assetId,
	).toBe(previous?.assetId);
});
it("hashes duration and aspect ratio, combines connected text, and enforces prompt limits", async () => {
	const source = createCanvasNode("text", { x: 0, y: 0 });
	source.data.content = "Original prompt";
	graph.nodes.push(source);
	graph.edges.push({
		id: crypto.randomUUID(),
		source: source.id,
		target: node.id,
		sourceHandle: "output",
		targetHandle: "prompt",
	});
	const first = await generationInputHash(graph, node.id);
	node.data.duration = 10;
	expect(await generationInputHash(graph, node.id)).not.toBe(first);
	node.data.duration = 5;
	node.data.aspectRatio = "1:1";
	expect(await generationInputHash(graph, node.id)).not.toBe(first);
	expect(
		buildImagePrompt(videoInputSnapshot(graph, node.id), [
			{ nodeId: source.id, output: "Generated context" },
		]),
	).toBe("Generated context\n\nWelcome to Kousa.");
	node.data.content = "a".repeat(12001);
	expect(() =>
		buildImagePrompt(videoInputSnapshot(graph, node.id), []),
	).toThrow("12 KB");
});
