import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaService } from "@kousa/media/service";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { defaultImageModel } from "../src/contracts";
import { planGraph } from "../src/graph-plan";
import { createGraphService } from "../src/graph-service";
import { executeGraphWorkflow } from "../src/graph-workflow";
import { createGenerationImageAccess } from "../src/image-access";
import type { VideoProvider } from "../src/providers";
import { createGenerationRunner } from "../src/runner";
import { executeGenerationWorkflow } from "../src/workflow";
import { inlineSteps, memoryArtifacts } from "./helpers";

const png = new Uint8Array(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOLsAAAAASUVORK5CYII=",
		"base64",
	),
);
const olderPng = new Uint8Array(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		"base64",
	),
);
const mp4 = new Uint8Array(
	readFileSync(new URL("../../media/test/fixtures/clip.mp4", import.meta.url)),
);
let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let graph: CanvasDocument;
let textNode = createCanvasNode("text", { x: 0, y: 0 });
let imageNode = createCanvasNode("image", { x: 300, y: 0 });
let videoNode = createCanvasNode("video", { x: 600, y: 0 });
let media: ReturnType<typeof createMediaService>;
let artifacts = memoryArtifacts();
const objects = new Map<string, Uint8Array<ArrayBuffer>>();
const text = vi.fn(async () => ({
	output: "A freshly generated scene",
	inputTokens: 1,
	outputTokens: 1,
}));
const image = vi.fn(async () => ({ bytes: png, mimeType: "image/png" }));
const start = vi.fn<VideoProvider["start"]>();
const poll = vi.fn<VideoProvider["poll"]>();
const dispatch = vi.fn(async (_id: string) => {});
const service = (origin = "https://kousa.app") =>
	createGraphService(
		db.graphs,
		db.store,
		createProjectService(db.projects, {
			appUrl: "https://kousa.app",
			email: {
				isConfigured: () => false,
				send: async () => ({ messageId: null }),
			},
		}),
		{ configured: true, imageInputOrigin: origin, dispatch },
		db.media,
	);
const runner = () =>
	createGenerationRunner(
		db.store,
		artifacts,
		{ configured: true, generate: text },
		{ configured: true, generate: image },
		media,
		undefined,
		{ configured: true, start, poll },
		createGenerationImageAccess(db.store, media).issue,
	);
const execute = (id: string, steps = inlineSteps) =>
	executeGraphWorkflow(id, db.graphs, db.store, runner(), steps);
const connect = (source: string, target: string, targetHandle: string) => ({
	id: crypto.randomUUID(),
	source,
	target,
	targetHandle,
	sourceHandle: "output" as const,
});
const request = async () => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId: videoNode.id,
	mode: "force" as const,
	inputHash: (
		await service().preview("owner", {
			projectId,
			nodeId: videoNode.id,
			mode: "force",
		})
	).inputHash,
});
async function upload(bytes = olderPng, pid = projectId) {
	return media.upload("owner", pid, {
		name: "starting.png",
		bytes,
		mimeType: "image/png",
	});
}
async function oldImage() {
	const asset = await upload();
	const id = crypto.randomUUID();
	await db.store.claim({
		id,
		userId: "owner",
		projectId,
		nodeId: imageNode.id,
		kind: "image",
		modelId: defaultImageModel,
		inputHash: "b".repeat(64),
		prompt: "Old prompt",
		size: "1024x1024",
		credits: 3,
	});
	await db.store.start(id);
	await db.store.finishMedia(id, asset.id);
	return asset.id;
}
async function imageOnly() {
	const asset = await upload();
	imageNode.data.imageSource = "project";
	imageNode.data.assetId = asset.id;
	graph.edges = [connect(imageNode.id, videoNode.id, "image")];
	await db.setGraph(projectId, graph);
	return asset.id;
}
beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	await db.grant("owner", 100);
	textNode = createCanvasNode("text", { x: 0, y: 0 });
	textNode.data.content = "Write a scene";
	imageNode = createCanvasNode("image", { x: 300, y: 0 });
	videoNode = createCanvasNode("video", { x: 600, y: 0 });
	videoNode.data.content = "Pan slowly";
	graph = {
		version: 1,
		nodes: [textNode, imageNode, videoNode],
		edges: [
			connect(textNode.id, imageNode.id, "prompt"),
			connect(imageNode.id, videoNode.id, "image"),
			connect(textNode.id, videoNode.id, "prompt"),
		],
	};
	await db.setGraph(projectId, graph);
	objects.clear();
	artifacts = memoryArtifacts();
	text.mockClear();
	image.mockClear();
	dispatch.mockClear();
	start.mockReset().mockResolvedValue({ job: "graph-video" });
	poll.mockReset().mockResolvedValue({
		status: "succeeded",
		bytes: mp4,
		mimeType: "video/mp4",
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
});

it("quotes a shared Text → Image → Video graph and invalidates previews when video settings change", async () => {
	const preview = await service().preview("owner", await request());
	expect(preview).toMatchObject({ credits: 14, balance: 100, blockers: [] });
	expect(preview.steps.map((step) => step.kind)).toEqual([
		"text",
		"image",
		"video",
	]);
	expect(preview.steps[2]).toMatchObject({
		credits: 10,
		imageInput: "generated",
	});
	const input = await request();
	videoNode.data.duration = 10;
	await db.setGraph(projectId, graph);
	await expect(service().start("owner", input)).rejects.toMatchObject({
		code: "CONFLICT",
	});
	expect((await service().preview("owner", await request())).credits).toBe(24);
	expect(await db.store.balance("owner")).toBe(100);
});

it("passes this workflow's new image and text to video, with durable polling and one charge", async () => {
	const previousImage = await oldImage();
	const input = await request();
	await service().start("owner", input);
	expect(await db.store.balance("owner")).toBe(83);
	start.mockImplementationOnce(async ({ id, imageUrl, prompt }) => {
		expect(prompt).toContain("A freshly generated scene");
		expect(prompt).toContain("Pan slowly");
		if (!imageUrl) throw new Error("Expected private input URL");
		const response = await createGenerationImageAccess(db.store, media).handle(
			new Request(imageUrl),
			id,
		);
		expect(response.status).toBe(200);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
		return { job: "graph-video" };
	});
	poll.mockResolvedValueOnce({ status: "pending" });
	const sleep = vi.fn(async () => {});
	await execute(input.id, { ...inlineSteps, sleep });
	const flow = await db.graphs.get(input.id);
	expect(flow?.status).toBe("succeeded");
	const results = await db.graphs.results(
		flow?.plan.map((step) => step.runId) ?? [],
	);
	const picture = results.find((run) => run.kind === "image");
	const clip = results.find((run) => run.kind === "video");
	expect(clip).toMatchObject({
		status: "succeeded",
		inputImageAssetId: picture?.assetId,
		duration: 5,
		aspectRatio: "16:9",
	});
	expect(clip?.inputImageAssetId).not.toBe(previousImage);
	expect(clip?.assetId).toBeTruthy();
	expect(sleep).toHaveBeenCalledWith("node-2-wait-for-video-0", 20_000);
	await execute(input.id);
	await service().start("owner", input);
	expect(start).toHaveBeenCalledTimes(1);
	expect(text).toHaveBeenCalledTimes(1);
	expect(image).toHaveBeenCalledTimes(1);
	expect(await db.store.balance("owner")).toBe(83);
});

it("reuses a selected project image and skips its generation ancestors", async () => {
	const assetId = await imageOnly();
	// An image source's old prompts do not apply when a project image is selected.
	textNode.data.content = "";
	graph.edges.push(connect(textNode.id, imageNode.id, "prompt"));
	videoNode.data.content = "";
	await db.setGraph(projectId, graph);
	const preview = await service().preview("owner", await request());
	expect(preview.credits).toBe(10);
	expect(preview.steps).toHaveLength(1);
	expect(preview.steps[0]?.imageInput).toBe("project");
	const input = await request();
	await service().start("owner", input);
	await execute(input.id);
	const [result] = await db.store.latest(projectId, [videoNode.id]);
	expect(result).toMatchObject({
		status: "succeeded",
		inputImageAssetId: assetId,
		prompt: "",
	});
	expect(text).not.toHaveBeenCalled();
	expect(image).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(90);
});

it("shows the full estimate but blocks all steps before charging without public image delivery", async () => {
	const input = await request();
	const local = service("http://localhost:3001");
	const preview = await local.preview("owner", input);
	expect(preview.credits).toBe(14);
	expect(preview.blockers[0]).toContain("public HTTPS");
	await expect(local.start("owner", input)).rejects.toMatchObject({
		code: "SERVICE_UNAVAILABLE",
	});
	expect(await db.graphs.get(input.id)).toBeNull();
	expect(await db.store.balance("owner")).toBe(100);
	expect(dispatch).not.toHaveBeenCalled();
});

it("runs text-only video without an image-delivery origin", async () => {
	graph.edges = [connect(textNode.id, videoNode.id, "prompt")];
	await db.setGraph(projectId, graph);
	const input = await request();
	const local = service("");
	expect(await local.preview("owner", input)).toMatchObject({
		credits: 11,
		blockers: [],
	});
	await local.start("owner", input);
	await execute(input.id);
	expect((await db.graphs.get(input.id))?.status).toBe("succeeded");
	expect(start.mock.calls[0]?.[0]).not.toHaveProperty("imageUrl");
	expect(image).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(89);
});

it("resumes only failed video, reusing the exact completed image despite later node outputs and edits", async () => {
	const input = await request();
	start.mockRejectedValueOnce(new Error("Gateway unavailable"));
	await service().start("owner", input);
	await execute(input.id);
	const failed = await db.graphs.get(input.id);
	expect(failed?.status).toBe("failed");
	const completedImage = (
		await db.store.outputs(projectId, [imageNode.id], "image")
	)[0]?.assetId;
	expect(await db.store.balance("owner")).toBe(96);
	const unrelated = await oldImage();
	expect(unrelated).not.toBe(completedImage);
	graph.edges = [];
	videoNode.data.duration = 10;
	videoNode.data.content = "Unrelated change";
	await db.setGraph(projectId, graph);
	const resume = { ...input, id: crypto.randomUUID(), resumeOf: input.id };
	const preview = await service().preview("owner", resume);
	expect(preview.credits).toBe(10);
	expect(preview.steps.map((step) => step.reused)).toEqual([true, true, false]);
	await service().start("owner", resume);
	await execute(resume.id);
	expect((await db.graphs.get(resume.id))?.status).toBe("succeeded");
	expect(text).toHaveBeenCalledTimes(1);
	expect(image).toHaveBeenCalledTimes(1);
	expect(start).toHaveBeenCalledTimes(2);
	const [clip] = await db.store.latest(projectId, [videoNode.id]);
	expect(clip).toMatchObject({
		inputImageAssetId: completedImage,
		duration: 5,
		inputImageOrigin: "https://kousa.app",
	});
	expect(clip?.prompt).toContain("Pan slowly");
	expect(await db.store.balance("owner")).toBe(83);
	const urls = start.mock.calls.map(([call]) => call.imageUrl);
	expect(urls[0]).not.toBe(urls[1]);
});

it("recovers an already-submitted video after loss of workflow checkpoints without resubmitting", async () => {
	await imageOnly();
	const input = await request();
	await service().start("owner", input);
	expect(await db.graphs.begin(input.id, 0, "Pan slowly")).toBe(true);
	const child = (await db.graphs.get(input.id))?.plan[0]?.runId;
	if (!child) throw new Error("Missing child");
	expect(await runner().generate(child)).toBe("pending");
	const tokenHash = (await db.store.get(child))?.inputImageTokenHash;
	await execute(input.id);
	expect((await db.graphs.get(input.id))?.status).toBe("succeeded");
	expect((await db.store.get(child))?.inputImageTokenHash).toBe(tokenHash);
	expect(start).toHaveBeenCalledTimes(1);
	expect(await db.store.balance("owner")).toBe(90);
});

it.each(["revoke", "expire"])(
	"stops before video and releases its reservation when access changes: %s",
	async (mode) => {
		await db.grant("editor", 14);
		const input = await request();
		await service().start("editor", input);
		const flow = await db.graphs.get(input.id);
		if (!flow) throw new Error("Missing plan");
		for (const [index, item] of flow.plan.slice(0, 2).entries()) {
			expect(await db.graphs.begin(input.id, index, "Prompt")).toBe(true);
			await executeGenerationWorkflow(item.runId, runner(), inlineSteps);
		}
		if (mode === "revoke") await db.revoke("editor");
		else await db.expireGraph(input.id);
		await execute(input.id);
		expect(start).not.toHaveBeenCalled();
		expect((await db.graphs.get(input.id))?.status).toBe("failed");
		expect(await db.store.balance("editor")).toBe(10);
		expect(await db.store.balance("owner")).toBe(100);
	},
);

it("rejects another project's selected image, including at the database boundary", async () => {
	await imageOnly();
	const other = await db.projects.create("owner", "Other project");
	imageNode.data.assetId = (await upload(png, other.id)).id;
	await db.setGraph(projectId, graph);
	const input = {
		id: crypto.randomUUID(),
		projectId,
		nodeId: videoNode.id,
		inputHash: (await planGraph(graph, videoNode.id)).inputHash,
	};
	await expect(service().preview("owner", input)).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
	await expect(service().start("owner", input)).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
	const planned = await planGraph(graph, videoNode.id);
	await db.graphs.claim({
		...input,
		userId: "owner",
		resumeOf: null,
		plan: planned.plan.map((step) => ({
			...step,
			runId: crypto.randomUUID(),
			inputImageOrigin: "https://kousa.app",
		})),
	});
	expect(await db.graphs.begin(input.id, 0, "Prompt")).toBe(false);
	expect((await db.graphs.get(input.id))?.remainingCredits).toBe(10);
	await db.graphs.finish(input.id, "Invalid input");
	expect(await db.store.balance("owner")).toBe(100);
});

it("blocks missing project images, extra images, unsupported video edges, and invalid durations", async () => {
	imageNode.data.imageSource = "project";
	await expect(planGraph(graph, videoNode.id)).rejects.toThrow(
		"available image",
	);
	imageNode.data.imageSource = "generated";
	const second = createCanvasNode("image", { x: 0, y: 400 });
	second.data.content = "Second image";
	graph.nodes.push(second);
	graph.edges.push(connect(second.id, videoNode.id, "image"));
	await expect(planGraph(graph, videoNode.id)).rejects.toThrow(
		"only one image",
	);
	graph.edges.pop();
	// @ts-expect-error Exercise malformed persisted settings before any reservation.
	videoNode.data.duration = 7;
	await expect(planGraph(graph, videoNode.id)).rejects.toThrow(
		"available video",
	);
	videoNode.data.duration = 5;
	const upstream = createCanvasNode("video", { x: 0, y: 500 });
	upstream.data.content = "Upstream clip";
	graph.nodes.push(upstream);
	graph.edges.push(connect(upstream.id, videoNode.id, "video"));
	await expect(planGraph(graph, videoNode.id)).rejects.toThrow(
		"Disconnect video",
	);
});

it("reserves the entire plan from the initiating editor and validates membership", async () => {
	const input = await request();
	await db.grant("editor", 13);
	await expect(service().start("editor", input)).rejects.toMatchObject({
		code: "PAYMENT_REQUIRED",
	});
	await expect(service().preview("viewer", input)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(service().start("viewer", input)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await db.grant("editor", 1);
	await service().start("editor", input);
	expect(await db.store.balance("editor")).toBe(0);
	await execute(input.id);
	expect(await db.store.balance("editor")).toBe(0);
	expect(await db.store.balance("owner")).toBe(100);
	expect(
		(await service().list("viewer", { projectId })).runs[0]?.steps.every(
			(step) => step.status === "succeeded",
		),
	).toBe(true);
});

it("stops before video if image generation fails and resumes the two unfinished steps", async () => {
	image.mockRejectedValueOnce(new Error("Image unavailable"));
	const input = await request();
	await service().start("owner", input);
	await execute(input.id);
	expect(start).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(99);
	const resumed = { ...input, id: crypto.randomUUID(), resumeOf: input.id };
	const preview = await service().preview("owner", resumed);
	expect(preview.credits).toBe(13);
	expect(preview.steps.map((step) => step.reused)).toEqual([
		true,
		false,
		false,
	]);
	await service().start("owner", resumed);
	await execute(resumed.id);
	expect((await db.graphs.get(resumed.id))?.status).toBe("succeeded");
	expect(text).toHaveBeenCalledTimes(1);
	expect(image).toHaveBeenCalledTimes(2);
	expect(start).toHaveBeenCalledTimes(1);
	expect(await db.store.balance("owner")).toBe(86);
});

it.each(["failed", "pending"] as const)(
	"releases only the video credits after provider status %s",
	async (status) => {
		poll.mockResolvedValue({ status });
		const input = await request();
		await service().start("owner", input);
		await execute(input.id);
		expect((await db.graphs.get(input.id))?.status).toBe("failed");
		expect(await db.store.balance("owner")).toBe(96);
		expect(start).toHaveBeenCalledTimes(1);
		const call = start.mock.calls[0]?.[0];
		if (!call?.imageUrl) throw new Error("Missing image URL");
		expect(
			(
				await createGenerationImageAccess(db.store, media).handle(
					new Request(call.imageUrl),
					call.id,
				)
			).status,
		).toBe(404);
		expect(
			await db.store.outputs(projectId, [imageNode.id], "image"),
		).toHaveLength(1);
	},
);

it("freezes a project image selection before the queued video starts", async () => {
	const selected = await imageOnly();
	const input = await request();
	await service().start("owner", input);
	imageNode.data.assetId = (await upload(png)).id;
	videoNode.data.content = "Changed after queuing";
	await db.setGraph(projectId, graph);
	await execute(input.id);
	const [clip] = await db.store.latest(projectId, [videoNode.id]);
	expect(clip).toMatchObject({
		status: "succeeded",
		inputImageAssetId: selected,
		prompt: "Pan slowly",
	});
});
