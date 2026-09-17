import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaHandler } from "@kousa/media/http";
import { createMediaService } from "@kousa/media/service";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
	defaultSpeechModel,
	defaultSpeechVoice,
	speechVoices,
} from "../src/contracts";
import {
	buildSpeechScript,
	generationInputHash,
	speechInputSnapshot,
} from "../src/input";
import type { SpeechProvider } from "../src/providers";
import { createGenerationRunner } from "../src/runner";
import { createGenerationService } from "../src/service";
import { executeGenerationWorkflow } from "../src/workflow";
import { inlineSteps, memoryArtifacts, unavailableImage } from "./helpers";

const audio = new Uint8Array(
	readFileSync(new URL("../../media/test/fixtures/tone.mp3", import.meta.url)),
);
let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let node = createCanvasNode("speech", { x: 0, y: 0 });
let graph: CanvasDocument;
let media: ReturnType<typeof createMediaService>;
let artifacts = memoryArtifacts();
const generate = vi.fn<SpeechProvider["generate"]>();
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
		{ configured: true, generate },
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
			speechConfigured: true,
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
	node = createCanvasNode("speech", { x: 0, y: 0 });
	node.data.content = "Welcome to Kousa.";
	node.data.voiceDirection = "Warm and calm";
	graph = { version: 1, nodes: [node], edges: [] };
	await db.setGraph(projectId, graph);
	await db.grant("owner", 10);
	objects.clear();
	artifacts = memoryArtifacts();
	generate
		.mockReset()
		.mockResolvedValue({ bytes: audio, mimeType: "audio/mpeg" });
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
it("queues an immutable script and voice, resumes receipts, publishes private MP3 and charges once", async () => {
	const input = await request();
	expect(await service().generate("owner", input)).toMatchObject({
		status: "queued",
		kind: "speech",
		credits: 2,
	});
	expect(generate).not.toHaveBeenCalled();
	node.data.content = "Edited while queued";
	node.data.voiceId = speechVoices[1].id;
	await db.setGraph(projectId, graph);
	expect(await runner().generate(input.id)).toBe(true);
	expect(await media.list("viewer", projectId)).toEqual([]);
	expect(await runner().generate(input.id)).toBe(true);
	const result = await runner().prepare(input.id);
	expect(await media.list("viewer", projectId)).toEqual([]);
	await runner().finalize(input.id, result);
	await runner().finalize(input.id, result);
	expect(generate).toHaveBeenCalledTimes(1);
	expect(generate).toHaveBeenCalledWith({
		modelId: defaultSpeechModel,
		voiceId: defaultSpeechVoice,
		voiceDirection: "Warm and calm",
		text: "Welcome to Kousa.",
	});
	const run = await service().generate("owner", input);
	expect(run).toMatchObject({
		status: "succeeded",
		assetId: expect.any(String),
		transcript: "Welcome to Kousa.",
	});
	expect(await db.store.balance("owner")).toBe(8);
	expect((await service().list("viewer", { projectId })).speechResults).toEqual(
		[run],
	);
	const asset = (await media.list("viewer", projectId))[0];
	expect(asset).toMatchObject({
		mimeType: "audio/mpeg",
		width: null,
		height: null,
		durationMs: expect.any(Number),
	});
	if (!asset) throw new Error("No audio");
	expect(asset.durationMs).toBeGreaterThan(100);
	const response = await http("viewer", asset.id);
	expect(response.status).toBe(200);
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(audio);
	expect([...objects.keys()][0]).toContain(`/audio/${asset.id}`);
});
it("serves exact byte ranges, suffixes and HEAD while enforcing access before range errors", async () => {
	const input = await request();
	await service().generate("owner", input);
	const run = await finish(input.id);
	if (!run?.assetId) throw new Error("No audio");
	const range = await http("viewer", run.assetId, "GET", "bytes=5-19");
	expect(range.status).toBe(206);
	expect(range.headers.get("content-range")).toBe(`bytes 5-19/${audio.length}`);
	expect(range.headers.get("content-length")).toBe("15");
	expect(new Uint8Array(await range.arrayBuffer())).toEqual(audio.slice(5, 20));
	const suffix = await http("viewer", run.assetId, "GET", "bytes=-7");
	expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(audio.slice(-7));
	const head = await http("viewer", run.assetId, "HEAD");
	expect(head.headers.get("content-length")).toBe(String(audio.length));
	expect(await head.text()).toBe("");
	for (const invalid of [
		"bytes=900000-",
		"bytes=20-3",
		"bytes=-0",
		"bytes=0-1,3-4",
		"bytes=a-b",
	]) {
		const response = await http("viewer", run.assetId, "GET", invalid);
		expect(response.status).toBe(416);
		expect(response.headers.get("content-range")).toBe(
			`bytes */${audio.length}`,
		);
		expect((await http("outsider", run.assetId, "GET", invalid)).status).toBe(
			404,
		);
	}
	expect((await http(null, run.assetId)).status).toBe(401);
	await db.revoke("viewer");
	expect((await http("viewer", run.assetId)).status).toBe(404);
});
it("reads connected successful text verbatim before local script and snapshots voice settings", async () => {
	const source = createCanvasNode("text", { x: 0, y: 0 });
	source.data.content = "Fallback script";
	graph.nodes.push(source);
	graph.edges.push({
		id: crypto.randomUUID(),
		source: source.id,
		target: node.id,
		sourceHandle: "output",
		targetHandle: "script",
	});
	expect(
		buildSpeechScript(speechInputSnapshot(graph, node.id), [
			{ nodeId: source.id, output: "Saved narration" },
		]),
	).toBe("Saved narration\n\nWelcome to Kousa.");
	expect(buildSpeechScript(speechInputSnapshot(graph, node.id), [])).toBe(
		"Fallback script\n\nWelcome to Kousa.",
	);
	const hash = await generationInputHash(graph, node.id);
	node.data.voiceId = speechVoices[1].id;
	expect(await generationInputHash(graph, node.id)).not.toBe(hash);
	const next = await generationInputHash(graph, node.id);
	node.data.voiceDirection = "excited";
	expect(await generationInputHash(graph, node.id)).not.toBe(next);
	source.type = "image";
	expect(() => speechInputSnapshot(graph, node.id)).toThrow(
		"text scripts only",
	);
});
it("rejects empty or oversized scripts and unknown voices/models before reserving credits", async () => {
	for (const change of [
		{ content: " " },
		{ content: "a".repeat(1001) },
		{ voiceId: "unknown" },
		{ speechModel: "unknown" },
	]) {
		const old = { ...node.data };
		Object.assign(node.data, change);
		await db.setGraph(projectId, graph);
		await expect(
			service().generate("owner", await request()),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		node.data = old;
	}
	expect(await db.store.balance("owner")).toBe(10);
	expect(generate).not.toHaveBeenCalled();
});
it("denies viewers and releases reservations if editing access is revoked", async () => {
	await expect(
		service().generate("viewer", await request()),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	await db.grant("editor", 2);
	const input = await request();
	await service().generate("editor", input);
	await db.revoke("editor");
	expect(await finish(input.id)).toMatchObject({ status: "failed" });
	expect(generate).not.toHaveBeenCalled();
	expect(await db.store.balance("editor")).toBe(2);
});
it.each(["provider", "invalid-mp3", "oversized", "revoked-after-provider"])(
	"releases failed %s audio without replacing the previous successful clip",
	async (failure) => {
		const first = await request();
		await service().generate("owner", first);
		const previous = await finish(first.id);
		if (failure === "provider")
			generate.mockRejectedValueOnce(new Error("Gateway unavailable"));
		if (failure === "invalid-mp3")
			generate.mockResolvedValueOnce({
				bytes: new Uint8Array(new TextEncoder().encode("not audio")),
				mimeType: "audio/mpeg",
			});
		if (failure === "oversized")
			generate.mockResolvedValueOnce({
				bytes: new Uint8Array(10 * 1024 * 1024 + 1),
				mimeType: "audio/mpeg",
			});
		const actor = failure === "revoked-after-provider" ? "editor" : "owner";
		if (actor === "editor") {
			await db.grant(actor, 2);
			generate.mockImplementationOnce(async () => {
				await db.revoke(actor);
				return { bytes: audio, mimeType: "audio/mpeg" };
			});
		}
		const input = await request();
		await service().generate(actor, input);
		expect(await finish(input.id)).toMatchObject({
			status: "failed",
			assetId: null,
		});
		expect(await db.store.balance("owner")).toBe(8);
		expect(
			(await service().list("viewer", { projectId })).speechResults[0]?.assetId,
		).toBe(previous?.assetId);
		expect(await media.list("viewer", projectId)).toHaveLength(1);
	},
);
it("rejects an image asset as a speech result atomically", async () => {
	const input = await request();
	await service().generate("owner", input);
	await db.store.start(input.id);
	const asset = await db.media.reserve({
		projectId,
		uploaderId: "owner",
		sha256: "a".repeat(64),
		name: "test.png",
		mimeType: "image/png",
		bytes: 10,
		width: 1,
		height: 1,
	});
	if (typeof asset === "string") throw new Error(asset);
	await expect(db.store.finishMedia(input.id, asset.id)).rejects.toThrow();
	expect(await media.list("viewer", projectId)).toEqual([]);
	expect(await db.store.get(input.id)).toMatchObject({
		status: "running",
		assetId: null,
	});
});
