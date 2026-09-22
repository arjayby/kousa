import { URL } from "node:url";
import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaService } from "@kousa/media/service";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { graphFreshness } from "../src/freshness";
import { createGraphService } from "../src/graph-service";
import { executeGraphWorkflow } from "../src/graph-workflow";
import {
	generationInputHash,
	textInputSnapshot,
	videoInputSnapshot,
} from "../src/input";
import { createGenerationMediaAccess } from "../src/media-access";
import type { TextProvider } from "../src/providers";
import { createGenerationRunner } from "../src/runner";
import { createGenerationService } from "../src/service";
import { executeGenerationWorkflow } from "../src/workflow";
import { inlineSteps, memoryArtifacts } from "./helpers";

const png = new Uint8Array(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOLsAAAAASUVORK5CYII=",
		"base64",
	),
);
let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let source = createCanvasNode("image", { x: 0, y: 0 });
let target = createCanvasNode("text", { x: 400, y: 0 });
let graph: CanvasDocument;
let media: ReturnType<typeof createMediaService>;
const generate = vi.fn<TextProvider["generate"]>();
const objects = new Map<string, Uint8Array<ArrayBuffer>>();
const projects = () =>
	createProjectService(db.projects, {
		appUrl: "http://localhost:3001",
		email: {
			isConfigured: () => false,
			send: async () => ({ messageId: null }),
		},
	});
const service = () =>
	createGenerationService(
		db.store,
		projects(),
		{
			textConfigured: true,
			imageConfigured: true,
			videoConfigured: true,
			imageInputOrigin: "https://kousa.app",
			dispatch: async () => {},
		},
		db.media,
	);
const graphs = () =>
	createGraphService(
		db.graphs,
		db.store,
		projects(),
		{
			configured: true,
			imageInputOrigin: "https://kousa.app",
			dispatch: async () => {},
		},
		db.media,
	);
const runner = () =>
	createGenerationRunner(
		db.store,
		memoryArtifacts(),
		{ configured: true, generate },
		{
			configured: false,
			generate: async () => {
				throw new Error("Unexpected image generation");
			},
		},
		media,
		undefined,
		undefined,
		undefined,
		undefined,
		createGenerationMediaAccess(db.store, media).load,
	);
const request = async () => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId: target.id,
	inputHash: await generationInputHash(graph, target.id),
	mediaAssetIds: source.data.assetId ? [source.data.assetId] : [],
});
const connect = (source: string, target: string, targetHandle: string) => ({
	id: crypto.randomUUID(),
	source,
	target,
	sourceHandle: "output" as const,
	targetHandle,
});
function firstEdge() {
	const edge = graph.edges[0];
	if (!edge) throw new Error("Missing edge");
	return edge;
}
beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	await db.grant("owner", 1000);
	objects.clear();
	generate.mockReset().mockResolvedValue({
		output: "A tiny image.",
		inputTokens: 25,
		outputTokens: 5,
	});
	media = createMediaService(db.media, db.projects, {
		put: async (key, bytes) => {
			objects.set(key, bytes);
		},
		get: async (key) => {
			const bytes = objects.get(key);
			return bytes
				? {
						bytes: bytes.length,
						body: new Response(bytes).body as ReadableStream,
					}
				: null;
		},
	});
	const asset = await media.upload("owner", projectId, {
		name: "tiny.png",
		bytes: png,
		mimeType: "image/png",
	});
	source = createCanvasNode("image", { x: 0, y: 0 });
	source.data.imageSource = "project";
	source.data.assetId = asset.id;
	target = createCanvasNode("text", { x: 400, y: 0 });
	target.data.textModel = "google/gemini-2.5-flash";
	target.data.content = "Describe the image.";
	graph = {
		version: 1,
		nodes: [source, target],
		edges: [connect(source.id, target.id, "context")],
	};
	await db.setGraph(projectId, graph);
});

it("freezes private media for a text run and marks changed attachments outdated", async () => {
	const input = await request();
	await service().generate("owner", input);
	source.data.assetId = crypto.randomUUID();
	await db.setGraph(projectId, graph);
	await executeGenerationWorkflow(input.id, runner(), inlineSteps);
	const run = await db.store.get(input.id);
	expect(run?.status).toBe("succeeded");
	expect(generate).toHaveBeenCalledWith(
		expect.objectContaining({
			media: [
				{ kind: "image", role: "context", mediaType: "image/png", bytes: png },
			],
		}),
	);
	expect(run?.resolvedInputs?.media?.[0]?.assetId).toBe(input.mediaAssetIds[0]);
	expect(graphFreshness(graph, run ? [run] : []).get(target.id)?.state).toBe(
		"outdated",
	);
});

it("rejects unreviewed and foreign inputs before reserving credits", async () => {
	const input = await request();
	await expect(
		service().generate("owner", { ...input, mediaAssetIds: [] }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	const other = await db.projects.create("owner", "Other");
	source.data.assetId = (
		await media.upload("owner", other.id, {
			name: "foreign.png",
			bytes: png,
			mimeType: "image/png",
		})
	).id;
	await db.setGraph(projectId, graph);
	await expect(
		service().generate("owner", await request()),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(await db.store.balance("owner")).toBe(1000);
	expect(generate).not.toHaveBeenCalled();
});

it("runs a workflow against fixed media and reuses unchanged results", async () => {
	const input = { projectId, nodeId: target.id };
	const preview = await graphs().preview("owner", input);
	const id = crypto.randomUUID();
	await graphs().start("owner", { ...input, id, inputHash: preview.inputHash });
	expect((await db.graphs.get(id))?.plan).toHaveLength(1);
	await executeGraphWorkflow(id, db.graphs, db.store, runner(), inlineSteps);
	expect((await db.graphs.get(id))?.status).toBe("succeeded");
	expect((await graphs().preview("owner", input)).credits).toBe(0);
	expect(generate).toHaveBeenCalledTimes(1);
});

it("delivers only frozen reference indices through a revocable scoped token", async () => {
	target.type = "video";
	target.data.aspectRatio = "16:9";
	target.data.videoModel = "spacexai/grok-imagine-video";
	firstEdge().targetHandle = "reference";
	await db.setGraph(projectId, graph);
	const input = await request();
	await service().generate("owner", input);
	await db.store.start(input.id);
	const run = await db.store.get(input.id);
	if (!run) throw new Error("Missing run");
	const access = createGenerationMediaAccess(db.store, media);
	const loaded = await access.load(run);
	const url = loaded[0]?.url;
	if (!url) throw new Error("Missing scoped URL");
	expect(
		await (await access.handle(new Request(url), run.id)).arrayBuffer(),
	).toEqual(png.buffer);
	expect(
		(
			await access.handle(
				new Request(url.replace("media=0", "media=1")),
				run.id,
			)
		).status,
	).toBe(404);
	expect(
		(
			await access.handle(
				new Request(url.replace(/token=[^&]+/, `token=${"a".repeat(64)}`)),
				run.id,
			)
		).status,
	).toBe(404);
	await db.store.finish(run.id, { error: "Cancelled test" });
	expect((await access.handle(new Request(url), run.id)).status).toBe(404);
});

it("checks model media support, last frame dependencies and incompatible mixes", () => {
	target.data.textModel = "amazon/nova-micro";
	expect(() => textInputSnapshot(graph, target.id)).toThrow(
		"does not accept image",
	);
	target.type = "video";
	target.data.videoModel = "bytedance/seedance-2.0";
	firstEdge().targetHandle = "lastFrame";
	expect(() => videoInputSnapshot(graph, target.id)).toThrow("starting frame");
	const first = createCanvasNode("image", { x: 0, y: 0 });
	graph.nodes.push(first);
	graph.edges.push(connect(first.id, target.id, "image"));
	expect(videoInputSnapshot(graph, target.id).media?.[0]?.role).toBe(
		"lastFrame",
	);
	firstEdge().targetHandle = "reference";
	expect(() => videoInputSnapshot(graph, target.id)).toThrow("without mixing");
});

it("resolves a video's last frame as image context without using its prompt", async () => {
	const { readFile } = await import("node:fs/promises");
	const bytes = new Uint8Array(
		await readFile(
			new URL("../../media/test/fixtures/clip.mp4", import.meta.url),
		),
	);
	const saved = await media.upload("owner", projectId, {
		bytes,
		mimeType: "video/mp4",
		name: "source.mp4",
	});
	source.type = "video";
	source.data.mediaSource = "project";
	source.data.assetId = saved.id;
	firstEdge().sourceHandle = "lastFrame";
	await db.setGraph(projectId, graph);
	const snapshot = textInputSnapshot(graph, target.id);
	expect(snapshot.sources).toHaveLength(0);
	expect(snapshot.media).toMatchObject([
		{ kind: "image", output: "lastFrame", source: "project" },
	]);
	const input = await request();
	await service().generate("owner", input);
	await db.store.start(input.id);
	const run = await db.store.get(input.id);
	if (!run) throw new Error("Missing run");
	const derive = vi
		.fn()
		.mockResolvedValue({ bytes: png, mimeType: "image/png" });
	const result = await createGenerationMediaAccess(
		db.store,
		media,
		derive,
	).load(run);
	expect(derive).toHaveBeenCalledWith(run.id, bytes, "lastFrame");
	expect(result).toEqual([
		{ kind: "image", role: "context", bytes: png, mediaType: "image/png" },
	]);
});
