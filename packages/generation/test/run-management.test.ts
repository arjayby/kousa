import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createGraphService } from "../src/graph-service";
import { executeGraphWorkflow } from "../src/graph-workflow";
import { createRunService } from "../src/run-service";
import { createGenerationRunner } from "../src/runner";
import { executeGenerationWorkflow } from "../src/workflow";
import {
	inlineSteps,
	memoryArtifacts,
	unavailableImage,
	unavailableMedia,
} from "./helpers";

let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let graph: CanvasDocument;
let a = createCanvasNode("text", { x: 0, y: 0 });
let b = createCanvasNode("text", { x: 300, y: 0 });
let receipts = memoryArtifacts();
const text = vi.fn(async () => ({
	output: "Saved output",
	inputTokens: 1,
	outputTokens: 1,
}));
const projects = () =>
	createProjectService(db.projects, {
		appUrl: "https://example.test",
		email: {
			isConfigured: () => false,
			send: async () => ({ messageId: null }),
		},
	});
const workflows = () =>
	createGraphService(
		db.graphs,
		db.store,
		projects(),
		{ configured: true, dispatch: async () => {} },
		db.media,
	);
const runs = () => createRunService(db.graphs, db.store, projects(), db.media);
const runner = () =>
	createGenerationRunner(
		db.store,
		receipts,
		{ configured: true, generate: text },
		unavailableImage,
		unavailableMedia,
	);
const result = { output: "Saved output", inputTokens: 1, outputTokens: 1 };
const flowRef = (id: string) => ({ id, projectId, kind: "workflow" as const });
const singleRef = (id: string) => ({
	id,
	projectId,
	kind: "generation" as const,
});
async function startFlow(actor = "owner", resumeOf?: string) {
	const estimate = await workflows().preview(actor, {
		projectId,
		nodeId: b.id,
		mode: "force",
		resumeOf,
	});
	return workflows().start(actor, {
		id: crypto.randomUUID(),
		projectId,
		nodeId: b.id,
		mode: "force",
		inputHash: estimate.inputHash,
		resumeOf,
	});
}
async function startSingle(actor = "owner") {
	const id = crypto.randomUUID();
	expect(
		await db.store.claim({
			id,
			projectId,
			nodeId: a.id,
			userId: actor,
			modelId: "amazon/nova-micro",
			prompt: "Saved prompt",
			inputHash: "a".repeat(64),
			credits: 1,
		}),
	).toEqual({ claimed: true });
	return id;
}
async function first(flowId: string) {
	const flow = await db.graphs.get(flowId);
	const step = flow?.plan[0];
	if (!step) throw new Error("Missing step");
	expect(await db.graphs.begin(flowId, 0, "Saved prompt")).toBe(true);
	return step.runId;
}
const execute = (id: string) =>
	executeGraphWorkflow(id, db.graphs, db.store, runner(), inlineSteps);
beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	a = createCanvasNode("text", { x: 0, y: 0 });
	a.data.content = "First prompt";
	b = createCanvasNode("text", { x: 300, y: 0 });
	b.data.content = "Second prompt";
	graph = {
		version: 1,
		nodes: [a, b],
		edges: [
			{
				id: crypto.randomUUID(),
				source: a.id,
				target: b.id,
				sourceHandle: "output",
				targetHandle: "context",
			},
		],
	};
	await db.setGraph(projectId, graph);
	await db.grant("owner", 20);
	await db.grant("editor", 20);
	receipts = memoryArtifacts();
	text.mockReset();
	text.mockResolvedValue(result);
});

it("atomically cancels queued standalone work and prevents late dispatch or charging", async () => {
	const id = await startSingle();
	expect(await db.store.balance("owner")).toBe(19);
	expect(await runs().cancel("owner", singleRef(id))).toMatchObject({
		status: "cancelled",
		credits: { total: 1, reserved: 0, charged: 0, released: 1 },
	});
	await runs().cancel("owner", singleRef(id));
	expect(await db.store.start(id)).toBe(false);
	await executeGenerationWorkflow(id, runner(), inlineSteps);
	expect(await db.store.finish(id, result)).toBeNull();
	expect(text).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(20);
});
it("retains submitted standalone reservations until the result succeeds", async () => {
	const id = await startSingle();
	expect(await db.store.start(id)).toBe(true);
	expect(await runs().cancel("editor", singleRef(id))).toMatchObject({
		status: "stopping",
		credits: { reserved: 1, released: 0 },
	});
	expect(await db.store.balance("owner")).toBe(19);
	await db.store.finish(id, result);
	expect(await runs().detail("viewer", singleRef(id))).toMatchObject({
		status: "succeeded",
		credits: { charged: 1, reserved: 0, released: 0 },
		steps: [{ output: "Saved output" }],
	});
	await runs().cancel("owner", singleRef(id));
	expect(await db.store.balance("owner")).toBe(19);
});
it("releases a submitted standalone reservation only after failure or expiry", async () => {
	const id = await startSingle();
	await db.store.start(id);
	await runs().cancel("owner", singleRef(id));
	await db.store.finish(id, { error: "Provider failed" });
	expect(await runs().detail("owner", singleRef(id))).toMatchObject({
		status: "failed",
		credits: { released: 1 },
	});
	const next = await startSingle();
	await db.store.start(next);
	await runs().cancel("owner", singleRef(next));
	await db.expire(next);
	expect(await runs().detail("owner", singleRef(next))).toMatchObject({
		status: "failed",
		credits: { released: 1 },
	});
	expect(await db.store.balance("owner")).toBe(20);
});
it("stops all unstarted workflow steps and releases the entire reservation once", async () => {
	const flow = await startFlow();
	const detail = await runs().cancel("owner", flowRef(flow.id));
	expect(detail).toMatchObject({
		status: "cancelled",
		credits: { total: 2, reserved: 0, charged: 0, released: 2 },
	});
	expect(
		detail.steps.every((s) => s.status === "cancelled" && s.runId === null),
	).toBe(true);
	await runs().cancel("editor", flowRef(flow.id));
	await execute(flow.id);
	expect(await db.graphs.begin(flow.id, 0, "Late queue")).toBe(false);
	expect(text).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(20);
});
it("cancels a child queued before the stop transaction", async () => {
	const flow = await startFlow();
	const id = await first(flow.id);
	expect(await runs().cancel("owner", flowRef(flow.id))).toMatchObject({
		status: "cancelled",
		credits: { released: 2 },
	});
	expect((await db.store.get(id))?.status).toBe("cancelled");
	expect(await db.store.start(id)).toBe(false);
	await execute(flow.id);
	expect(text).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(20);
});
it("stopping during a provider call preserves its output and does not submit later steps", async () => {
	const flow = await startFlow();
	text.mockImplementationOnce(async () => {
		expect(await runs().cancel("editor", flowRef(flow.id))).toMatchObject({
			status: "stopping",
			credits: { total: 2, reserved: 1, charged: 0, released: 1 },
		});
		expect(await db.store.balance("owner")).toBe(19);
		return result;
	});
	await execute(flow.id);
	expect(text).toHaveBeenCalledTimes(1);
	const detail = await runs().detail("viewer", flowRef(flow.id));
	expect(detail).toMatchObject({
		status: "cancelled",
		credits: { total: 2, reserved: 0, charged: 1, released: 1 },
	});
	expect(detail.steps.map((s) => s.status)).toEqual(["succeeded", "cancelled"]);
	expect(detail.steps[0]?.output).toBe("Saved output");
	expect(await db.store.balance("owner")).toBe(19);
});
it("recovers submitted work after a stop without repeating a paid call", async () => {
	const flow = await startFlow();
	const id = await first(flow.id);
	await db.store.start(id);
	await receipts.put(id, { kind: "text", ...result });
	await runs().cancel("owner", flowRef(flow.id));
	expect(await db.graphs.finish(flow.id, "Late worker error")).toBe(false);
	expect((await db.graphs.get(flow.id))?.status).toBe("running");
	await execute(flow.id);
	expect(text).not.toHaveBeenCalled();
	expect(await runs().detail("owner", flowRef(flow.id))).toMatchObject({
		status: "cancelled",
		credits: { charged: 1, released: 1 },
	});
	expect(await db.store.balance("owner")).toBe(19);
});
it("reconciles an expired submitted step while a workflow is stopping", async () => {
	const flow = await startFlow();
	const id = await first(flow.id);
	await db.store.start(id);
	await runs().cancel("owner", flowRef(flow.id));
	await db.expire(id);
	expect(await runs().detail("owner", flowRef(flow.id))).toMatchObject({
		status: "cancelled",
		credits: { reserved: 0, released: 2 },
	});
	await execute(flow.id);
	expect(text).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(20);
});
it("reuses successful steps when the original payer resumes a cancelled workflow", async () => {
	const flow = await startFlow();
	const id = await first(flow.id);
	await db.store.start(id);
	await db.store.finish(id, result);
	await runs().cancel("owner", flowRef(flow.id));
	await expect(startFlow("editor", flow.id)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	const resumed = await startFlow("owner", flow.id);
	expect(await runs().detail("owner", flowRef(resumed.id))).toMatchObject({
		credits: { total: 1, charged: 0, reserved: 1, released: 0 },
	});
	expect((await runs().detail("owner", flowRef(flow.id))).resumed).toBe(true);
	await execute(resumed.id);
	expect(text).toHaveBeenCalledTimes(1);
	expect(await runs().detail("owner", flowRef(resumed.id))).toMatchObject({
		status: "succeeded",
		credits: { total: 1, charged: 1, reserved: 0, released: 0 },
	});
	expect(await db.store.balance("owner")).toBe(18);
	await expect(startFlow("owner", flow.id)).rejects.toMatchObject({
		code: "CONFLICT",
	});
});
it("does not relabel or refund a workflow whose final output already completed", async () => {
	const flow = await startFlow();
	const saved = await db.graphs.get(flow.id);
	for (const [index, step] of (saved?.plan ?? []).entries()) {
		expect(await db.graphs.begin(flow.id, index, "Saved prompt")).toBe(true);
		expect(await db.store.start(step.runId)).toBe(true);
		await db.store.finish(step.runId, result);
	}
	// Stop arrives after the last child committed but before the parent completed.
	expect((await db.graphs.get(flow.id))?.status).toBe("running");
	expect(await runs().cancel("owner", flowRef(flow.id))).toMatchObject({
		status: "succeeded",
		cancelRequestedAt: null,
		credits: { charged: 2, released: 0 },
	});
	await runs().cancel("owner", flowRef(flow.id));
	await execute(flow.id);
	expect(text).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(18);
});
it("enforces project access and edit permissions for history, details, and stops", async () => {
	const flow = await startFlow("editor");
	expect((await runs().history("viewer", { projectId })).runs[0]?.id).toBe(
		flow.id,
	);
	await expect(runs().cancel("viewer", flowRef(flow.id))).rejects.toMatchObject(
		{ code: "FORBIDDEN" },
	);
	await expect(runs().history("outsider", { projectId })).rejects.toBeDefined();
	await expect(
		runs().detail("outsider", flowRef(flow.id)),
	).rejects.toBeDefined();
	expect(await db.graphs.cancel(flow.id, projectId, "viewer")).toBe(
		"FORBIDDEN",
	);
	await db.revoke("editor");
	expect(await db.graphs.cancel(flow.id, projectId, "editor")).toBe(
		"FORBIDDEN",
	);
	await expect(runs().cancel("editor", flowRef(flow.id))).rejects.toBeDefined();
	await runs().cancel("owner", flowRef(flow.id));
	expect(await db.store.balance("editor")).toBe(20);
});
it("rejects direct cancellation of a workflow child and incorrect project IDs", async () => {
	const flow = await startFlow();
	const id = await first(flow.id);
	await expect(runs().cancel("owner", singleRef(id))).rejects.toMatchObject({
		code: "CONFLICT",
	});
	expect(await db.graphs.cancel(flow.id, crypto.randomUUID(), "owner")).toBe(
		"NOT_FOUND",
	);
	expect(await db.store.cancel(id, crypto.randomUUID(), "owner")).toBe(
		"NOT_FOUND",
	);
	await expect(
		runs().detail("owner", singleRef(crypto.randomUUID())),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expect(await db.store.balance("owner")).toBe(18);
});
it("rechecks authorization atomically if edit access changes during a stop request", async () => {
	const flow = await startFlow();
	const projectService = projects();
	const original = projectService.get;
	const changing = {
		get: async (...args: Parameters<typeof original>) => {
			const result = await original(...args);
			await db.revoke("editor");
			return result;
		},
	};
	await expect(
		createRunService(db.graphs, db.store, changing, db.media).cancel(
			"editor",
			flowRef(flow.id),
		),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	expect((await db.graphs.get(flow.id))?.cancelRequestedAt).toBeNull();
});
it("paginates individual and workflow history without duplicate children or losing older runs", async () => {
	const ids: string[] = [];
	for (let i = 0; i < 24; i++) {
		if (i % 2) {
			const flow = await startFlow();
			ids.push(flow.id);
			await runs().cancel("owner", flowRef(flow.id));
		} else {
			const id = await startSingle();
			ids.push(id);
			await runs().cancel("owner", singleRef(id));
		}
	}
	let page = await runs().history("viewer", { projectId, limit: 7 });
	const seen = page.runs.map((r) => r.id);
	const newer = await startSingle();
	await runs().cancel("owner", singleRef(newer));
	while (page.nextCursor) {
		page = await runs().history("viewer", {
			projectId,
			limit: 7,
			cursor: page.nextCursor,
		});
		seen.push(...page.runs.map((r) => r.id));
	}
	expect(seen).toEqual(ids.reverse());
	expect(new Set(seen).size).toBe(24);
	await db.setGraph(projectId, { version: 1, nodes: [], edges: [] });
	expect((await runs().history("viewer", { projectId })).runs[0]?.id).toBe(
		newer,
	);
	expect(
		(await runs().detail("viewer", singleRef(newer))).steps[0]?.prompt,
	).toBe("Saved prompt");
});
