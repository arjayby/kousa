import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaService } from "@kousa/media/service";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { planGraph } from "../src/graph-plan";
import { createGraphService } from "../src/graph-service";
import { executeGraphWorkflow } from "../src/graph-workflow";
import { createGenerationRunner } from "../src/runner";
import { inlineSteps, memoryArtifacts } from "./helpers";

let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let graph: CanvasDocument;
let a = createCanvasNode("text", { x: 0, y: 0 });
let b = createCanvasNode("text", { x: 200, y: 0 });
let c = createCanvasNode("image", { x: 400, y: 0 });
let artifacts = memoryArtifacts();
const text = vi.fn(async ({ prompt }: { prompt: string }) => ({
	output: `Result(${prompt})`,
	inputTokens: 1,
	outputTokens: 1,
}));
const image = vi.fn(async () => ({
	bytes: new Uint8Array(
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOLsAAAAASUVORK5CYII=",
			"base64",
		),
	),
	mimeType: "image/png",
}));
const dispatch = vi.fn(async (_id: string) => {});
const projects = () =>
	createProjectService(db.projects, {
		appUrl: "https://example.test",
		email: {
			isConfigured: () => false,
			send: async () => ({ messageId: null }),
		},
	});
const service = () =>
	createGraphService(db.graphs, db.store, projects(), {
		configured: true,
		dispatch,
	});
const runner = () =>
	createGenerationRunner(
		db.store,
		artifacts,
		{ configured: true, generate: text },
		{ configured: true, generate: image },
		createMediaService(db.media, db.projects, {
			put: async () => {},
			get: async () => null,
		}),
	);
const request = async (nodeId = c.id) => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId,
	inputHash: (await planGraph(graph, nodeId)).inputHash,
});
const execute = (id: string) =>
	executeGraphWorkflow(id, db.graphs, db.store, runner(), inlineSteps);
const connect = (source: string, target: string, targetHandle = "context") => ({
	id: crypto.randomUUID(),
	source,
	target,
	sourceHandle: "output" as const,
	targetHandle,
});

beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	a = createCanvasNode("text", { x: 0, y: 0 });
	a.data.content = "First idea";
	b = createCanvasNode("text", { x: 200, y: 0 });
	b.data.content = "Write a visual prompt";
	c = createCanvasNode("image", { x: 400, y: 0 });
	graph = {
		version: 1,
		nodes: [a, b, c],
		edges: [connect(a.id, b.id), connect(b.id, c.id, "prompt")],
	};
	await db.setGraph(projectId, graph);
	await db.grant("owner", 20);
	artifacts = memoryArtifacts();
	text.mockClear();
	image.mockClear();
	dispatch.mockClear();
});

it("plans ancestors in order, excludes unrelated nodes, and detects stale prompts", async () => {
	const extra = createCanvasNode("speech", { x: 0, y: 0 });
	graph.nodes.push(extra);
	const planned = await planGraph(graph, c.id);
	expect(planned.plan.map((step) => step.nodeId)).toEqual([a.id, b.id, c.id]);
	const preview = await service().preview("owner", {
		projectId,
		nodeId: c.id,
		inputHash: planned.inputHash,
	});
	expect(preview).toMatchObject({ credits: 5, balance: 20 });
	a.data.content = "Changed";
	await db.setGraph(projectId, graph);
	await expect(
		service().start("owner", {
			id: crypto.randomUUID(),
			projectId,
			nodeId: c.id,
			inputHash: preview.inputHash,
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(await db.store.balance("owner")).toBe(20);
});
it("runs Text → Text → Image using exact outputs, reserves once, and replays safely", async () => {
	const input = await request();
	await service().start("owner", input);
	expect(await db.store.balance("owner")).toBe(15);
	expect(text).not.toHaveBeenCalled();
	expect(await db.graphs.pending()).toEqual([{ id: input.id }]);
	await service().start("owner", input);
	await execute(input.id);
	expect(text).toHaveBeenCalledTimes(2);
	expect(text.mock.calls[1]?.[0].prompt).toContain("Result(First idea)");
	expect(image).toHaveBeenCalledWith(
		expect.objectContaining({
			prompt: expect.stringContaining("Result(Connected text context:"),
		}),
	);
	expect((await db.graphs.get(input.id))?.status).toBe("succeeded");
	expect(await db.store.balance("owner")).toBe(15);
	expect(await db.credits.summary("owner")).toEqual({ balance: 15 });
	expect((await db.media.list(projectId)).length).toBe(1);
	await execute(input.id);
	expect(text).toHaveBeenCalledTimes(2);
	expect(image).toHaveBeenCalledTimes(1);
});
it("stops at a failed step, refunds unfinished steps, resumes without regenerating successes", async () => {
	text
		.mockImplementationOnce(async () => ({
			output: "First saved output",
			inputTokens: 1,
			outputTokens: 1,
		}))
		.mockRejectedValueOnce(new Error("Provider unavailable"));
	const input = await request();
	await service().start("owner", input);
	await execute(input.id);
	expect(image).not.toHaveBeenCalled();
	expect((await db.graphs.get(input.id))?.status).toBe("failed");
	expect(await db.store.balance("owner")).toBe(19);
	const preview = await service().preview("owner", {
		projectId,
		nodeId: c.id,
		resumeOf: input.id,
	});
	expect(preview.credits).toBe(4);
	expect(preview.steps[0]?.reused).toBe(true);
	const resumed = { ...input, id: crypto.randomUUID(), resumeOf: input.id };
	await service().start("owner", resumed);
	expect(await db.store.balance("owner")).toBe(15);
	await execute(resumed.id);
	expect(text).toHaveBeenCalledTimes(3);
	expect(image).toHaveBeenCalledTimes(1);
	expect((await db.graphs.get(resumed.id))?.status).toBe("succeeded");
	await expect(
		service().start("owner", { ...resumed, id: crypto.randomUUID() }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(await db.store.balance("owner")).toBe(15);
});
it("freezes the graph and protects overlapping workflows and single-node charges", async () => {
	const input = await request();
	await service().start("owner", input);
	a.data.content = "Edited while running";
	graph.edges = [];
	await db.setGraph(projectId, graph);
	await expect(
		service().start("owner", await request(a.id)),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(
		await db.store.claim({
			id: crypto.randomUUID(),
			projectId,
			nodeId: a.id,
			userId: "owner",
			credits: 1,
			inputHash: "a".repeat(64),
			modelId: "amazon/nova-micro",
			prompt: "Single",
		}),
	).toMatchObject({ error: "BUSY" });
	await execute(input.id);
	expect(text.mock.calls[0]?.[0].prompt).toBe("First idea");
	expect(text.mock.calls[1]?.[0].prompt).toContain("Result(First idea)");
});
it("viewers read shared progress but cannot preview or start, and outsiders cannot read", async () => {
	const input = await request();
	await service().start("owner", input);
	expect(
		(await service().list("viewer", { projectId })).runs[0]?.steps,
	).toHaveLength(3);
	await expect(service().preview("viewer", input)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(service().start("viewer", input)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(service().list("outsider", { projectId })).rejects.toBeDefined();
});
it("charges the initiating editor and refuses the full plan when credits are insufficient", async () => {
	await db.grant("editor", 4);
	await expect(
		service().start("editor", await request()),
	).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
	await db.grant("editor", 1);
	const input = await request();
	await service().start("editor", input);
	expect(await db.store.balance("editor")).toBe(0);
	expect(await db.store.balance("owner")).toBe(20);
	await execute(input.id);
	expect(await db.store.balance("editor")).toBe(0);
});
it("revocation between steps prevents downstream provider calls and releases reservations", async () => {
	await db.grant("editor", 5);
	const input = await request();
	await service().start("editor", input);
	const flow = await db.graphs.get(input.id);
	const first = flow?.plan[0];
	if (!first) throw new Error("Missing first step");
	await db.graphs.begin(input.id, 0, "First idea");
	await db.store.start(first.runId);
	await db.store.finish(first.runId, {
		output: "Saved",
		inputTokens: 1,
		outputTokens: 1,
	});
	await db.revoke("editor");
	await execute(input.id);
	expect(text).not.toHaveBeenCalled();
	expect(image).not.toHaveBeenCalled();
	expect(await db.store.balance("editor")).toBe(4);
});
it("recovery skips completed steps even when durable checkpoints are lost", async () => {
	const input = await request();
	await service().start("owner", input);
	const flow = await db.graphs.get(input.id);
	const first = flow?.plan[0];
	if (!first) throw new Error("Missing first step");
	await db.graphs.begin(input.id, 0, "First idea");
	await db.store.start(first.runId);
	await db.store.finish(first.runId, {
		output: "Saved before interruption",
		inputTokens: 1,
		outputTokens: 1,
	});
	await execute(input.id);
	expect(text).toHaveBeenCalledTimes(1);
	expect(image).toHaveBeenCalledTimes(1);
	expect(text.mock.calls[0]?.[0].prompt).toContain("Saved before interruption");
	expect(await db.store.balance("owner")).toBe(15);
});
it("expiration releases pending reservations and late workers cannot spend", async () => {
	const input = await request();
	await service().start("owner", input);
	await db.expireGraph(input.id);
	await db.graphs.expire();
	await execute(input.id);
	expect(text).not.toHaveBeenCalled();
	expect(image).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(20);
});
it("rejects cycles, unsupported connections and empty prompts before charging", async () => {
	graph.edges.push(connect(c.id, a.id));
	await expect(planGraph(graph, c.id)).rejects.toThrow("cycle");
	graph.edges.pop();
	a.type = "speech";
	await expect(planGraph(graph, c.id)).rejects.toThrow(
		"connected text nodes only",
	);
	a.type = "text";
	a.data.content = "";
	await expect(planGraph(graph, c.id)).rejects.toThrow("Write a prompt");
});
it("deduplicates shared ancestors in a branching graph", async () => {
	const sibling = createCanvasNode("text", { x: 0, y: 0 });
	sibling.data.content = "Another perspective";
	graph.nodes.push(sibling);
	graph.edges.push(
		connect(a.id, sibling.id),
		connect(sibling.id, c.id, "prompt"),
	);
	const planned = await planGraph(graph, c.id);
	expect(planned.plan).toHaveLength(4);
	expect(planned.plan.filter((step) => step.nodeId === a.id)).toHaveLength(1);
});

it("moves a reservation to a child atomically and rejects out-of-order starts", async () => {
	const input = await request();
	await service().start("owner", input);
	expect(await db.graphs.begin(input.id, 1, "Out of order")).toBe(false);
	expect(await db.graphs.begin(input.id, 0, "First idea")).toBe(true);
	expect(await db.graphs.begin(input.id, 0, "First idea")).toBe(true);
	expect(await db.store.balance("owner")).toBe(15);
	expect((await db.graphs.get(input.id))?.remainingCredits).toBe(4);
	expect(await db.store.pending()).toEqual([]);
	await db.graphs.finish(input.id, "Stopped");
	expect(await db.store.balance("owner")).toBe(20);
	expect(await db.graphs.begin(input.id, 1, "Late worker")).toBe(false);
});
it("limits the number of steps and rejects image references before reserving", async () => {
	const nodes = Array.from({ length: 21 }, () => {
		const node = createCanvasNode("text", { x: 0, y: 0 });
		node.data.content = "Prompt";
		return node;
	});
	const edges = nodes
		.slice(1)
		.map((node, index) => connect(nodes[index]?.id ?? "", node.id));
	await expect(
		planGraph({ version: 1, nodes, edges }, nodes[20]?.id ?? ""),
	).rejects.toThrow("20 connected nodes");
	const reference = createCanvasNode("image", { x: 0, y: 0 });
	reference.data.content = "Reference";
	graph.nodes.push(reference);
	graph.edges.push(connect(reference.id, c.id, "reference"));
	await expect(planGraph(graph, c.id)).rejects.toThrow("text prompts only");
	expect(await db.store.balance("owner")).toBe(20);
});
it("prevents reusing workflow IDs for single generations and the reverse", async () => {
	const input = await request();
	await service().start("owner", input);
	const single = {
		id: input.id,
		projectId,
		nodeId: a.id,
		userId: "owner",
		credits: 1,
		inputHash: "a".repeat(64),
		modelId: "amazon/nova-micro",
		prompt: "Single",
	};
	expect(await db.store.claim(single)).toMatchObject({ error: "CONFLICT" });
	await db.graphs.finish(input.id, "Stopped");
	const id = crypto.randomUUID();
	await db.store.claim({ ...single, id });
	await expect(
		service().start("owner", { ...input, id }),
	).rejects.toMatchObject({ code: "CONFLICT" });
});
it("only the original payer may resume and completed output survives a later stop request", async () => {
	const input = await request();
	await service().start("owner", input);
	await db.graphs.finish(input.id, "Interrupted");
	await expect(
		service().preview("editor", {
			projectId,
			nodeId: c.id,
			resumeOf: input.id,
		}),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	const next = { ...input, id: crypto.randomUUID(), resumeOf: input.id };
	await service().start("owner", next);
	await execute(next.id);
	expect(await db.graphs.finish(next.id, "Late failure")).toBe(false);
	expect((await db.graphs.get(next.id))?.status).toBe("succeeded");
	expect(await db.store.balance("owner")).toBe(15);
});
