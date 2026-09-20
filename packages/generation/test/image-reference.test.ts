import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaService } from "@kousa/media/service";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { defaultImageModel } from "../src/contracts";
import { graphFreshness } from "../src/freshness";
import { createGraphService } from "../src/graph-service";
import { executeGraphWorkflow } from "../src/graph-workflow";
import { createGenerationImageAccess } from "../src/image-access";
import { createImageVariations } from "../src/image-variations";
import { generationInputHash } from "../src/input";
import type { ImageProvider } from "../src/providers";
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
const editedPng = new Uint8Array(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		"base64",
	),
);
let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let source = createCanvasNode("image", { x: 0, y: 0 });
let target = createCanvasNode("image", { x: 400, y: 0 });
let graph: CanvasDocument;
let media: ReturnType<typeof createMediaService>;
let assetId: string;
let artifacts = memoryArtifacts();
const generate = vi.fn<ImageProvider["generate"]>();
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
			textConfigured: false,
			imageConfigured: true,
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
			dispatch: async () => {},
		},
		db.media,
	);
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
		{ configured: true, generate },
		media,
		undefined,
		undefined,
		undefined,
		createGenerationImageAccess(db.store, media).bytes,
	);
const request = async (image = assetId) => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId: target.id,
	inputHash: await generationInputHash(graph, target.id),
	inputImageAssetId: image,
});
async function upload(bytes = png, pid = projectId) {
	return media.upload("owner", pid, {
		name: "product.png",
		bytes,
		mimeType: "image/png",
	});
}
async function savedOutput(bytes = png) {
	const asset = await upload(bytes);
	const id = crypto.randomUUID();
	await db.store.claim({
		id,
		projectId,
		nodeId: source.id,
		userId: "owner",
		kind: "image",
		modelId: defaultImageModel,
		prompt: "A product",
		inputHash: "a".repeat(64),
		credits: 3,
		size: "1024x1024",
	});
	await db.store.start(id);
	await db.store.finishMedia(id, asset.id);
	return { id, assetId: asset.id };
}
async function startGraph() {
	const input = { projectId, nodeId: target.id };
	const preview = await graphs().preview("owner", input);
	const id = crypto.randomUUID();
	await graphs().start("owner", { ...input, id, inputHash: preview.inputHash });
	return { id, preview };
}
beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	await db.grant("owner", 50);
	await db.grant("editor", 50);
	objects.clear();
	artifacts = memoryArtifacts();
	generate
		.mockReset()
		.mockResolvedValue({ bytes: editedPng, mimeType: "image/png" });
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
	assetId = (await upload()).id;
	source = createCanvasNode("image", { x: 0, y: 0 });
	source.data.imageSource = "project";
	source.data.assetId = assetId;
	target = createCanvasNode("image", { x: 400, y: 0 });
	target.data.content =
		"Replace the background with a beige studio. Keep the product label.";
	graph = {
		version: 1,
		nodes: [source, target],
		edges: [
			{
				id: crypto.randomUUID(),
				source: source.id,
				target: target.id,
				sourceHandle: "output",
				targetHandle: "reference",
			},
		],
	};
	await db.setGraph(projectId, graph);
});

it("delivers the frozen private photo bytes, preserves the original, and charges once across retries", async () => {
	const input = await request();
	await service().generate("owner", input);
	source.data.assetId = (await upload(editedPng)).id;
	target.data.content = "A different edit";
	await db.setGraph(projectId, graph);
	await executeGenerationWorkflow(input.id, runner(), inlineSteps);
	await executeGenerationWorkflow(input.id, runner(), inlineSteps);
	const result = await db.store.get(input.id);
	expect(generate).toHaveBeenCalledTimes(1);
	expect(generate).toHaveBeenCalledWith(
		expect.objectContaining({
			referenceImage: png,
			prompt: expect.stringContaining("beige studio"),
		}),
	);
	expect(result).toMatchObject({
		status: "succeeded",
		inputImageAssetId: assetId,
		inputImageOrigin: null,
		inputImageTokenHash: null,
		resolvedInputs: { image: { nodeId: source.id, runId: null, assetId } },
	});
	expect(result?.assetId).not.toBe(assetId);
	expect(await db.media.get(projectId, assetId)).not.toBeNull();
	expect(await db.store.balance("owner")).toBe(47);
});

it("requires the reviewed reference and rejects foreign and missing assets before reserving credits", async () => {
	await expect(
		service().generate("owner", await request(crypto.randomUUID())),
	).rejects.toMatchObject({ code: "CONFLICT" });
	const other = await db.projects.create("owner", "Other");
	for (const id of [(await upload(png, other.id)).id, crypto.randomUUID()]) {
		source.data.assetId = id;
		await db.setGraph(projectId, graph);
		await expect(
			service().generate("owner", await request(id)),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	}
	expect(await db.store.balance("owner")).toBe(50);
	expect(generate).not.toHaveBeenCalled();
});

it.each(["revoked access", "missing object"])(
	"rechecks %s at execution and releases credits without a provider call",
	async (failure) => {
		const input = await request();
		await service().generate("editor", input);
		if (failure === "revoked access") await db.revoke("editor");
		else objects.clear();
		await executeGenerationWorkflow(input.id, runner(), inlineSteps);
		expect((await db.store.get(input.id))?.status).toBe("failed");
		expect(await db.store.balance("editor")).toBe(50);
		expect(generate).not.toHaveBeenCalled();
	},
);

it("uses a pinned historical image even when a newer output exists", async () => {
	const historical = await savedOutput();
	await savedOutput(editedPng);
	source.data.selectedRunId = historical.id;
	source.data.imageSource = "generated";
	await db.setGraph(projectId, graph);
	const input = await request(historical.assetId);
	await service().generate("owner", input);
	await executeGenerationWorkflow(input.id, runner(), inlineSteps);
	expect(generate).toHaveBeenCalledWith(
		expect.objectContaining({ referenceImage: png }),
	);
	expect((await db.store.get(input.id))?.resolvedInputs?.image).toEqual({
		nodeId: source.id,
		runId: historical.id,
		assetId: historical.assetId,
	});
});

it("runs only the edit for uploaded references, reuses unchanged results, and invalidates changed photos", async () => {
	const { id, preview } = await startGraph();
	expect(preview.blockers).toEqual([]);
	expect(preview.steps).toHaveLength(1);
	expect(preview.steps[0]).toMatchObject({
		kind: "image",
		imageInput: "project",
	});
	expect(preview.credits).toBe(3);
	await executeGraphWorkflow(id, db.graphs, db.store, runner(), inlineSteps);
	expect((await db.graphs.get(id))?.status).toBe("succeeded");
	expect(generate).toHaveBeenCalledWith(
		expect.objectContaining({ referenceImage: png }),
	);
	const outputs = await db.store.outputs(projectId, [target.id], "image");
	expect(graphFreshness(graph, outputs).get(target.id)?.state).toBe("current");
	expect(
		(await graphs().preview("owner", { projectId, nodeId: target.id })).credits,
	).toBe(0);
	source.data.assetId = (await upload(editedPng)).id;
	await db.setGraph(projectId, graph);
	expect(graphFreshness(graph, outputs).get(target.id)?.state).toBe("outdated");
	expect(
		(await graphs().preview("owner", { projectId, nodeId: target.id })).credits,
	).toBe(3);
});

it("passes the exact upstream generated result into a chained image edit", async () => {
	source.data.imageSource = "generated";
	source.data.assetId = undefined;
	source.data.content = "A product on a table";
	await db.setGraph(projectId, graph);
	generate.mockResolvedValueOnce({ bytes: png, mimeType: "image/png" });
	const { id, preview } = await startGraph();
	expect(preview.credits).toBe(6);
	await executeGraphWorkflow(id, db.graphs, db.store, runner(), inlineSteps);
	expect((await db.graphs.get(id))?.status).toBe("succeeded");
	expect(generate).toHaveBeenCalledTimes(2);
	expect(generate.mock.calls[0]?.[0].referenceImage).toBeUndefined();
	expect(generate.mock.calls[1]?.[0].referenceImage).toEqual(png);
	const outputs = await db.store.outputs(
		projectId,
		[source.id, target.id],
		"image",
	);
	const upstream = outputs.find((run) => run.nodeId === source.id);
	expect(
		outputs.find((run) => run.nodeId === target.id)?.resolvedInputs?.image,
	).toEqual({
		nodeId: source.id,
		runId: upstream?.id,
		assetId: upstream?.assetId,
	});
	expect(graphFreshness(graph, outputs).get(target.id)?.state).toBe("current");
});

it("uses historical references in workflows without rerunning the source", async () => {
	const historical = await savedOutput();
	source.data.selectedRunId = historical.id;
	await db.setGraph(projectId, graph);
	const { id, preview } = await startGraph();
	expect(preview.steps).toHaveLength(1);
	expect(preview.steps[0]?.imageInput).toBe("history");
	await executeGraphWorkflow(id, db.graphs, db.store, runner(), inlineSteps);
	expect((await db.graphs.get(id))?.status).toBe("succeeded");
	expect(generate).toHaveBeenCalledTimes(1);
	expect(generate.mock.calls[0]?.[0].referenceImage).toEqual(png);
});

it("runs identical variations separately against one pinned reference, charges once per output and reuses both", async () => {
	const insertion = createImageVariations(graph, {
		sourceId: source.id,
		mode: "image",
		referenceAssetId: assetId,
		prompt: "Create a product ad. Keep the product unchanged.",
		variations: [
			{ instructions: "", aspectRatio: "1:1" },
			{ instructions: "", aspectRatio: "1:1" },
		],
	});
	graph = {
		version: 1,
		nodes: [...graph.nodes, ...insertion.nodes],
		edges: [...graph.edges, ...insertion.edges],
	};
	await db.setGraph(projectId, graph);
	const input = { projectId, nodeIds: insertion.targetIds };
	const preview = await graphs().preview("owner", input);
	expect(preview.credits).toBe(6);
	expect(preview.steps).toHaveLength(2);
	const id = crypto.randomUUID();
	await graphs().start("owner", { ...input, id, inputHash: preview.inputHash });
	await executeGraphWorkflow(id, db.graphs, db.store, runner(), inlineSteps);
	expect((await db.graphs.get(id))?.status).toBe("succeeded");
	expect(generate).toHaveBeenCalledTimes(2);
	expect(
		generate.mock.calls.every((call) =>
			call[0].referenceImage?.every((byte, index) => byte === png[index]),
		),
	).toBe(true);
	expect(await db.store.balance("owner")).toBe(44);
	const outputs = await db.store.outputs(
		projectId,
		insertion.targetIds,
		"image",
	);
	expect(new Set(outputs.map((output) => output.nodeId)).size).toBe(2);
	expect(new Set(outputs.map((output) => output.id)).size).toBe(2);
	expect((await graphs().preview("owner", input)).credits).toBe(0);
	await executeGraphWorkflow(id, db.graphs, db.store, runner(), inlineSteps);
	expect(generate).toHaveBeenCalledTimes(2);
	expect(await db.store.balance("owner")).toBe(44);
});
