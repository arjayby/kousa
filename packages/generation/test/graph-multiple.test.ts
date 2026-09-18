import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaService } from "@kousa/media/service";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { graphOutputIds, planGraph } from "../src/graph-plan";
import { createGraphService } from "../src/graph-service";
import { executeGraphWorkflow } from "../src/graph-workflow";
import { createGenerationImageAccess } from "../src/image-access";
import type { SpeechProvider, VideoProvider } from "../src/providers";
import { createGenerationRunner } from "../src/runner";
import { createGenerationService } from "../src/service";
import { inlineSteps, memoryArtifacts } from "./helpers";

const png = new Uint8Array(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOLsAAAAASUVORK5CYII=",
		"base64",
	),
);
const audio = new Uint8Array(
	readFileSync(new URL("../../media/test/fixtures/tone.mp3", import.meta.url)),
);
const video = new Uint8Array(
	readFileSync(new URL("../../media/test/fixtures/clip.mp4", import.meta.url)),
);
const node = (
	kind: "text" | "image" | "video" | "speech",
	ordinal: number,
) => ({
	...createCanvasNode(kind, { x: ordinal * 200, y: 0 }),
	id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
});
let idea = node("text", 1);
let picture = node("image", 2);
let clip = node("video", 3);
let narration = node("speech", 4);
let graph: CanvasDocument;
let projectId: string;
let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let media: ReturnType<typeof createMediaService>;
let artifacts = memoryArtifacts();
const text = vi.fn(async () => ({
	output: "A quiet street.",
	inputTokens: 1,
	outputTokens: 1,
}));
const image = vi.fn(async () => ({ bytes: png, mimeType: "image/png" }));
const speech = vi.fn<SpeechProvider["generate"]>();
const startVideo = vi.fn<VideoProvider["start"]>();
const pollVideo = vi.fn<VideoProvider["poll"]>();
const dispatch = vi.fn(async (_id: string) => {});
const connect = (source: string, target: string, targetHandle: string) => ({
	id: crypto.randomUUID(),
	source,
	target,
	sourceHandle: "output" as const,
	targetHandle,
});
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
const execute = (id: string) =>
	executeGraphWorkflow(
		id,
		db.graphs,
		db.store,
		createGenerationRunner(
			db.store,
			artifacts,
			{ configured: true, generate: text },
			{ configured: true, generate: image },
			media,
			{ configured: true, generate: speech },
			{ configured: true, start: startVideo, poll: pollVideo },
			createGenerationImageAccess(db.store, media).issue,
		),
		inlineSteps,
	);
const request = async (nodeIds = [clip.id, narration.id]) => ({
	id: crypto.randomUUID(),
	projectId,
	nodeIds,
	inputHash: (await planGraph(graph, nodeIds)).inputHash,
});

beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	await db.grant("owner", 100);
	idea = node("text", 1);
	idea.data.content = "Describe a quiet street.";
	picture = node("image", 2);
	clip = node("video", 3);
	clip.data.content = "Pan slowly";
	narration = node("speech", 4);
	graph = {
		version: 1,
		nodes: [idea, picture, clip, narration],
		edges: [
			connect(idea.id, picture.id, "prompt"),
			connect(picture.id, clip.id, "image"),
			connect(idea.id, narration.id, "script"),
		],
	};
	await db.setGraph(projectId, graph);
	artifacts = memoryArtifacts();
	text.mockClear();
	image.mockClear();
	dispatch.mockClear();
	speech
		.mockReset()
		.mockResolvedValue({ bytes: audio, mimeType: "audio/mpeg" });
	startVideo.mockReset().mockResolvedValue({ job: "multiple-video" });
	pollVideo.mockReset().mockResolvedValue({
		status: "succeeded",
		bytes: video,
		mimeType: "video/mp4",
	});
	const objects = new Map<string, Uint8Array<ArrayBuffer>>();
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

it("quotes the union of output branches once and hashes the selection independent of order", async () => {
	const input = await request();
	expect(graphOutputIds(graph)).toEqual([clip.id, narration.id]);
	const preview = await service().preview("owner", input);
	expect(preview).toMatchObject({
		credits: 16,
		balance: 100,
		blockers: [],
		targetNodeIds: input.nodeIds,
	});
	expect(preview.steps.map((step) => [step.nodeId, step.isOutput])).toEqual([
		[idea.id, false],
		[picture.id, false],
		[clip.id, true],
		[narration.id, true],
	]);
	expect((await request([...input.nodeIds].reverse())).inputHash).toBe(
		input.inputHash,
	);
	expect((await request([idea.id, ...input.nodeIds])).inputHash).not.toBe(
		input.inputHash,
	);
	expect(
		(
			await service().preview(
				"owner",
				await request([idea.id, ...input.nodeIds]),
			)
		).credits,
	).toBe(16);
	expect((await planGraph(graph, clip.id)).inputHash).toBe(
		(await planGraph(graph, [clip.id])).inputHash,
	);
});
it("runs all four kinds, shares exact ancestors, saves every output and charges only once", async () => {
	const input = await request();
	await service().start("owner", input);
	expect(await db.store.balance("owner")).toBe(84);
	await service().start("owner", {
		...input,
		nodeIds: [...input.nodeIds].reverse(),
	});
	await execute(input.id);
	expect((await db.graphs.get(input.id))?.status).toBe("succeeded");
	expect(text).toHaveBeenCalledTimes(1);
	expect(image).toHaveBeenCalledTimes(1);
	expect(speech).toHaveBeenCalledTimes(1);
	expect(startVideo).toHaveBeenCalledTimes(1);
	expect(speech).toHaveBeenCalledWith(
		expect.objectContaining({ text: "A quiet street." }),
	);
	const flow = await db.graphs.get(input.id);
	const imageChild = await db.store.get(flow?.plan[1]?.runId ?? "");
	const videoChild = await db.store.get(flow?.plan[2]?.runId ?? "");
	expect(videoChild?.inputImageAssetId).toBe(imageChild?.assetId);
	expect((await db.media.list(projectId)).length).toBe(3);
	await execute(input.id);
	expect(text).toHaveBeenCalledTimes(1);
	expect(startVideo).toHaveBeenCalledTimes(1);
	expect(await db.store.balance("owner")).toBe(84);
	const viewed = await service().list("viewer", { projectId });
	expect(
		viewed.runs[0]?.steps
			.filter((step) => step.isOutput)
			.map((step) => step.status),
	).toEqual(["succeeded", "succeeded"]);
});
it("preserves a finished video branch and resumes failed speech against the frozen shared text", async () => {
	speech.mockRejectedValueOnce(new Error("Speech unavailable"));
	const input = await request();
	await service().start("owner", input);
	await execute(input.id);
	expect((await db.graphs.get(input.id))?.status).toBe("failed");
	expect(await db.store.balance("owner")).toBe(86);
	const original = await db.graphs.get(input.id);
	graph.nodes = [];
	graph.edges = [];
	await db.setGraph(projectId, graph);
	const preview = await service().preview("owner", {
		...input,
		resumeOf: input.id,
	});
	expect(preview.credits).toBe(2);
	expect(preview.steps.map((step) => step.reused)).toEqual([
		true,
		true,
		true,
		false,
	]);
	const resumed = { ...input, id: crypto.randomUUID(), resumeOf: input.id };
	await service().start("owner", resumed);
	await execute(resumed.id);
	const saved = await db.graphs.get(resumed.id);
	expect(saved?.status).toBe("succeeded");
	expect(saved?.plan.slice(0, 3).map((step) => step.runId)).toEqual(
		original?.plan.slice(0, 3).map((step) => step.runId),
	);
	expect(text).toHaveBeenCalledTimes(1);
	expect(image).toHaveBeenCalledTimes(1);
	expect(startVideo).toHaveBeenCalledTimes(1);
	expect(speech).toHaveBeenCalledTimes(2);
	expect(await db.store.balance("owner")).toBe(84);
	await expect(
		service().start("owner", { ...resumed, id: crypto.randomUUID() }),
	).rejects.toMatchObject({ code: "CONFLICT" });
});
it("releases every unfinished branch when their common input fails", async () => {
	text.mockRejectedValueOnce(new Error("Text unavailable"));
	const input = await request();
	await service().start("owner", input);
	await execute(input.id);
	expect(await db.store.balance("owner")).toBe(100);
	expect(image).not.toHaveBeenCalled();
	expect(speech).not.toHaveBeenCalled();
	expect(startVideo).not.toHaveBeenCalled();
	const run = (await service().list("owner", { projectId })).runs[0];
	expect(
		run?.steps
			.filter((step) => step.isOutput)
			.every((step) => step.status === "blocked"),
	).toBe(true);
});
it("binds replay to the complete output set in both service and atomic SQL claims", async () => {
	const input = await request();
	await service().start("owner", input);
	const changed = { ...(await request([clip.id])), id: input.id };
	await expect(service().start("owner", changed)).rejects.toMatchObject({
		code: "CONFLICT",
	});
	await expect(
		service().start("owner", { ...input, inputHash: "b".repeat(64) }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	const saved = await db.graphs.get(input.id);
	if (!saved) throw new Error("Missing workflow");
	expect(
		await db.graphs.claim({ ...saved, inputHash: changed.inputHash }),
	).toMatchObject({ error: "CONFLICT" });
	expect(await db.graphs.claim(saved)).toEqual({ claimed: false });
	expect(await db.store.balance("owner")).toBe(84);
});
it("checks the entire cost against the actor and keeps progress readable to viewers", async () => {
	const input = await request();
	await expect(service().preview("viewer", input)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(service().start("viewer", input)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(service().start("outsider", input)).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
	await db.grant("editor", 15);
	await expect(service().start("editor", input)).rejects.toMatchObject({
		code: "PAYMENT_REQUIRED",
	});
	await db.grant("editor", 1);
	await service().start("editor", input);
	expect(await db.store.balance("editor")).toBe(0);
	expect(await db.store.balance("owner")).toBe(100);
	await db.revoke("editor");
	await execute(input.id);
	expect(text).not.toHaveBeenCalled();
	expect(await db.store.balance("editor")).toBe(16);
	expect((await service().list("viewer", { projectId })).runs[0]?.status).toBe(
		"failed",
	);
	await expect(
		service().preview("owner", { ...input, resumeOf: input.id }),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("rejects stale edits or invalid branches and blocks image delivery before any reservation", async () => {
	const input = await request();
	expect((await service("").preview("owner", input)).blockers).toHaveLength(1);
	await expect(service("").start("owner", input)).rejects.toMatchObject({
		code: "SERVICE_UNAVAILABLE",
	});
	narration.data.voiceDirection = "Excited";
	await db.setGraph(projectId, graph);
	await expect(service().start("owner", input)).rejects.toMatchObject({
		code: "CONFLICT",
	});
	await expect(
		service().preview("owner", {
			projectId,
			nodeIds: [clip.id, crypto.randomUUID()],
		}),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	graph.edges.push(connect(narration.id, idea.id, "context"));
	await db.setGraph(projectId, graph);
	await expect(planGraph(graph, [clip.id, narration.id])).rejects.toMatchObject(
		{ code: "BAD_REQUEST" },
	);
	expect(await db.store.balance("owner")).toBe(100);
	expect(dispatch).not.toHaveBeenCalled();
});
it("keeps a fixed video image even when that image is selected for separate regeneration", async () => {
	const asset = await media.upload("owner", projectId, {
		name: "fixed.png",
		bytes: png,
		mimeType: "image/png",
	});
	picture.data.imageSource = "project";
	picture.data.assetId = asset.id;
	await db.setGraph(projectId, graph);
	expect(
		(await service().preview("owner", await request([clip.id]))).credits,
	).toBe(10);
	const input = await request([picture.id, clip.id]);
	expect((await service().preview("owner", input)).credits).toBe(14);
	await service().start("owner", input);
	await execute(input.id);
	const flow = await db.graphs.get(input.id);
	expect(flow?.status).toBe("succeeded");
	const videoStep = flow?.plan.find((step) => step.kind === "video");
	expect((await db.store.get(videoStep?.runId ?? ""))?.inputImageAssetId).toBe(
		asset.id,
	);
});
it("enforces the combined twenty-step limit across otherwise valid separate branches", async () => {
	const nodes = Array.from({ length: 21 }, (_, index) => {
		const n = node("text", index + 1);
		n.data.content = "Idea";
		return n;
	});
	graph = {
		version: 1,
		nodes,
		edges: nodes.flatMap((n, index) => {
			const previous = nodes[index - 1];
			return previous && index !== 11
				? [connect(previous.id, n.id, "context")]
				: [];
		}),
	};
	const targets = graphOutputIds(graph);
	expect(targets).toHaveLength(2);
	for (const target of targets)
		await expect(planGraph(graph, target)).resolves.toHaveProperty("plan");
	await expect(planGraph(graph, targets)).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
	await expect(planGraph(graph, [])).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
});
it("resumes historical single-output plans without markers and refuses a changed output set", async () => {
	const { plan } = await planGraph(graph, clip.id);
	const legacy = {
		id: crypto.randomUUID(),
		projectId,
		nodeId: clip.id,
		userId: "owner",
		inputHash: "c".repeat(64),
		resumeOf: null,
		plan: plan.map(({ target: _target, ...step }) => ({
			...step,
			runId: crypto.randomUUID(),
		})),
	};
	expect(await db.graphs.claim(legacy)).toEqual({ claimed: true });
	await db.graphs.finish(legacy.id, "Test interruption");
	expect(
		(await service().list("viewer", { projectId })).runs[0]?.targetNodeIds,
	).toEqual([clip.id]);
	const input = { projectId, nodeIds: [clip.id], resumeOf: legacy.id };
	const preview = await service().preview("owner", input);
	expect(preview.inputHash).toBe(legacy.inputHash);
	expect(
		preview.steps.filter((step) => step.isOutput).map((step) => step.nodeId),
	).toEqual([clip.id]);
	await expect(
		service().preview("owner", { ...input, nodeIds: [clip.id, narration.id] }),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	const resumed = await service().start("owner", {
		...input,
		id: crypto.randomUUID(),
		inputHash: preview.inputHash,
	});
	await execute(resumed.id);
	expect((await db.graphs.get(resumed.id))?.status).toBe("succeeded");
});

it("includes workflow children in history with restorable authored settings", async () => {
	const input = await request();
	await service().start("owner", input);
	await execute(input.id);
	const history = createGenerationService(
		db.store,
		createProjectService(db.projects, {
			appUrl: "https://kousa.app",
			email: {
				isConfigured: () => false,
				send: async () => ({ messageId: null }),
			},
		}),
		{ textConfigured: true, imageConfigured: true, dispatch },
		db.media,
	);
	for (const node of graph.nodes) {
		const page = await history.history("viewer", {
			projectId,
			nodeId: node.id,
		});
		expect(page.runs[0]).toMatchObject({
			graphRunId: input.id,
			status: "succeeded",
			creditState: "charged",
			settings: { kind: node.type, content: node.data.content },
		});
	}
});

it("freezes a historical image for a video workflow without regenerating its ancestors", async () => {
	const original = await request();
	await service().start("owner", original);
	await execute(original.id);
	const first = (await db.store.outputs(projectId, [picture.id], "image"))[0];
	if (!first) throw new Error("Missing image run");
	image.mockResolvedValueOnce({
		bytes: new Uint8Array([...png, 0]),
		mimeType: "image/png",
	});
	const replacement = await request([picture.id]);
	await service().start("owner", replacement);
	await execute(replacement.id);
	expect(
		(await db.store.outputs(projectId, [picture.id], "image"))[0]?.assetId,
	).not.toBe(first.assetId);
	picture.data.selectedRunId = first.id;
	await db.setGraph(projectId, graph);
	const selected = await request([clip.id]);
	const preview = await service().preview("owner", selected);
	expect(preview).toMatchObject({
		credits: 10,
		steps: [{ nodeId: clip.id, imageInput: "history" }],
	});
	const imageCalls = image.mock.calls.length;
	const textCalls = text.mock.calls.length;
	await service().start("owner", selected);
	picture.data.selectedRunId = null;
	await db.setGraph(projectId, graph);
	await execute(selected.id);
	const flow = await db.graphs.get(selected.id);
	expect(flow?.status).toBe("succeeded");
	if (!flow?.plan[0]) throw new Error("Missing video step");
	expect((await db.store.get(flow.plan[0].runId))?.inputImageAssetId).toBe(
		first.assetId,
	);
	expect(image).toHaveBeenCalledTimes(imageCalls);
	expect(text).toHaveBeenCalledTimes(textCalls);
});

it("keeps pinned text fixed even when that same node is explicitly regenerated", async () => {
	const original = await request([idea.id]);
	await service().start("owner", original);
	await execute(original.id);
	const first = (await db.store.outputs(projectId, [idea.id]))[0];
	if (!first) throw new Error("Missing text run");
	idea.data.selectedRunId = first.id;
	await db.setGraph(projectId, graph);
	text.mockResolvedValueOnce({
		output: "A different street.",
		inputTokens: 1,
		outputTokens: 1,
	});
	const next = await request([idea.id, narration.id]);
	await service().start("owner", next);
	await execute(next.id);
	expect((await db.graphs.get(next.id))?.status).toBe("succeeded");
	expect(speech).toHaveBeenLastCalledWith(
		expect.objectContaining({ text: "A quiet street." }),
	);
	const onlyNarration = await service().preview(
		"owner",
		await request([narration.id]),
	);
	expect(onlyNarration).toMatchObject({
		credits: 2,
		steps: [{ nodeId: narration.id }],
	});
});

it.each(["", "Changed authored text. ".repeat(100)])(
	"validates pinned text instead of its edited authored prompt (%#)",
	async (content) => {
		const original = await request([idea.id]);
		await service().start("owner", original);
		await execute(original.id);
		const first = (await db.store.outputs(projectId, [idea.id]))[0];
		if (!first) throw new Error("Missing text run");
		idea.data.selectedRunId = first.id;
		idea.data.content = content;
		await db.setGraph(projectId, graph);
		const next = await request([picture.id, narration.id]);
		expect(await service().preview("owner", next)).toMatchObject({
			credits: 5,
		});
		await service().start("owner", next);
		await execute(next.id);
		expect((await db.graphs.get(next.id))?.status).toBe("succeeded");
		expect(text).toHaveBeenCalledTimes(1);
		expect(speech).toHaveBeenLastCalledWith(
			expect.objectContaining({ text: first.output }),
		);
	},
);

it("rejects oversized historical narration before reserving workflow credits", async () => {
	text.mockResolvedValueOnce({
		output: "a".repeat(1_001),
		inputTokens: 1,
		outputTokens: 1,
	});
	const original = await request([idea.id]);
	await service().start("owner", original);
	await execute(original.id);
	const first = (await db.store.outputs(projectId, [idea.id]))[0];
	if (!first) throw new Error("Missing text run");
	idea.data.selectedRunId = first.id;
	await db.setGraph(projectId, graph);
	const balance = await db.store.balance("owner");
	const next = await request([narration.id]);
	await expect(service().start("owner", next)).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
	expect(await db.graphs.get(next.id)).toBeNull();
	expect(await db.store.balance("owner")).toBe(balance);
	expect(speech).not.toHaveBeenCalled();
});
