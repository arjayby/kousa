import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import {
	type CanvasDocument,
	type CanvasNode,
	createCanvasNode,
	generationNodeKind,
} from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { generationInputHash } from "../src/input";
import { createGenerationService } from "../src/service";

let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let graph: CanvasDocument;
let node: CanvasNode;
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
	createGenerationService(
		db.store,
		projects(),
		{
			textConfigured: true,
			imageConfigured: true,
			speechConfigured: true,
			videoConfigured: true,
			imageInputOrigin: "https://example.test",
			dispatch,
		},
		db.media,
	);
async function queue(target = node, actor = "owner") {
	return service().generate(actor, {
		id: crypto.randomUUID(),
		projectId,
		nodeId: target.id,
		inputHash: await generationInputHash(graph, target.id),
	});
}
async function success(target = node, text = "First output", actor = "owner") {
	const run = await queue(target, actor);
	await db.store.start(run.id);
	if (target.type === "text")
		await db.store.finish(run.id, {
			output: text,
			inputTokens: 1,
			outputTokens: 1,
		});
	else {
		const asset = await db.media.reserve({
			projectId,
			uploaderId: actor,
			name: `${target.type}.file`,
			sha256: run.id.replaceAll("-", "").repeat(2),
			mimeType:
				target.type === "image"
					? "image/png"
					: target.type === "video"
						? "video/mp4"
						: "audio/mpeg",
			bytes: 100,
			width: target.type === "image" || target.type === "video" ? 1 : null,
			height: target.type === "image" || target.type === "video" ? 1 : null,
			durationMs: target.type === "image" ? null : 5_000,
		});
		if (typeof asset === "string") throw new Error("Missing asset");
		await db.store.finishMedia(run.id, asset.id);
	}
	const saved = await db.store.get(run.id);
	if (!saved) throw new Error("Missing saved run");
	return saved;
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
	await db.grant("editor", 100);
	node = createCanvasNode("text", { x: 0, y: 0 });
	node.data.content = "Original authored prompt";
	graph = { version: 1, nodes: [node], edges: [] };
	await db.setGraph(projectId, graph);
	dispatch.mockClear();
});

it.each(["text", "image", "video", "speech"] as const)(
	"browses frozen %s details and prepares separate zero-cost selection/restoration",
	async (kind) => {
		node.type = generationNodeKind(kind);
		node.data.aspectRatio = "16:9";
		node.data.duration = 10;
		node.data.voiceDirection = "Calm";
		await db.setGraph(projectId, graph);
		const first = await success();
		node.data.content = "Changed prompt";
		node.data.duration = 5;
		node.data.aspectRatio = "1:1";
		await db.setGraph(projectId, graph);
		const second = await success(node, "Second output", "editor");
		const beforeBalance = await db.store.balance("owner");
		const beforeDispatch = dispatch.mock.calls.length;
		const page = await service().history("viewer", {
			projectId,
			nodeId: node.id,
		});
		expect(page.runs.map((run) => run.id)).toEqual([second.id, first.id]);
		expect(page.runs[1]).toMatchObject({
			userName: "owner",
			prompt: "Original authored prompt",
			creditState: "charged",
			settings: { kind, content: "Original authored prompt" },
			mediaAvailable: true,
		});
		expect(page.runs[1]?.completedAt).toBeTruthy();
		const selected = await service().historyAction("editor", {
			projectId,
			nodeId: node.id,
			runId: first.id,
			action: "select",
		});
		expect(selected.patch).toMatchObject({ selectedRunId: first.id });
		expect(selected.patch).not.toHaveProperty("content");
		Object.assign(node.data, selected.patch);
		await db.setGraph(projectId, graph);
		const restored = await service().historyAction("owner", {
			projectId,
			nodeId: node.id,
			runId: first.id,
			action: "restore",
		});
		expect(restored.patch).toMatchObject({
			content: "Original authored prompt",
		});
		expect(restored.patch).not.toHaveProperty("selectedRunId");
		if (kind === "video")
			expect(restored.patch).toMatchObject({
				duration: 10,
				aspectRatio: "16:9",
			});
		if (kind === "speech")
			expect(restored.patch).toMatchObject({ voiceDirection: "Calm" });
		expect(await db.store.get(first.id)).toEqual(first);
		expect(await db.store.balance("owner")).toBe(beforeBalance);
		expect(dispatch).toHaveBeenCalledTimes(beforeDispatch);
	},
);

it("paginates deterministically while new attempts arrive", async () => {
	const ids: string[] = [];
	for (let i = 0; i < 6; i++) ids.push((await success(node, `Output ${i}`)).id);
	const first = await service().history("viewer", {
		projectId,
		nodeId: node.id,
		limit: 2,
	});
	await success(node, "New arrival");
	const second = await service().history("viewer", {
		projectId,
		nodeId: node.id,
		limit: 2,
		cursor: first.nextCursor,
	});
	const third = await service().history("viewer", {
		projectId,
		nodeId: node.id,
		limit: 2,
		cursor: second.nextCursor,
	});
	expect(
		[...first.runs, ...second.runs, ...third.runs].map((run) => run.id),
	).toEqual(ids.reverse());
	expect(third.nextCursor).toBeNull();
});

it("protects history, cross-node selections, and revoked editor access", async () => {
	const run = await success();
	const request = {
		projectId,
		nodeId: node.id,
		runId: run.id,
		action: "select",
	};
	await expect(service().history("outsider", request)).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
	await expect(
		service().historyAction("viewer", request),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	const other = createCanvasNode("text", { x: 100, y: 0 });
	graph.nodes.push(other);
	await db.setGraph(projectId, graph);
	await expect(
		service().historyAction("owner", { ...request, nodeId: other.id }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await db.revoke("editor");
	await expect(
		service().historyAction("editor", request),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	const foreign = await db.projects.create("owner", "Other project");
	const listed = await service().list("owner", {
		projectId: foreign.id,
		selections: [{ nodeId: node.id, runId: run.id }],
	});
	expect(listed.selectedResults).toEqual([]);
});

it("retains chosen text through an active job, forbids restoring active settings, and shows releases", async () => {
	const first = await success();
	const active = await queue();
	const request = { projectId, nodeId: node.id, runId: first.id };
	expect((await service().history("viewer", request)).runs[0]).toMatchObject({
		status: "queued",
		creditState: "reserved",
	});
	await expect(
		service().historyAction("owner", { ...request, action: "restore" }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	const selection = await service().historyAction("owner", {
		...request,
		action: "select",
	});
	Object.assign(node.data, selection.patch);
	await db.setGraph(projectId, graph);
	await db.store.finish(active.id, { error: "Provider failed" });
	const page = await service().history("viewer", request);
	expect(page.runs[0]).toMatchObject({
		status: "failed",
		creditState: "released",
		error: "Provider failed",
	});
	const listed = await service().list("viewer", {
		projectId,
		nodeIds: [node.id],
		selections: [{ nodeId: node.id, runId: first.id }],
	});
	expect(listed.runs[0]?.id).toBe(active.id);
	expect(listed.selectedResults[0]?.output).toBe("First output");
	await expect(
		service().historyAction("owner", {
			...request,
			runId: active.id,
			action: "select",
		}),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("uses the chosen text for future downstream work and freezes already queued inputs", async () => {
	const first = await success(node, "Version one");
	await success(node, "Version two");
	const downstream = createCanvasNode("audio", { x: 300, y: 0 });
	downstream.data.content = "Closing words";
	graph.nodes.push(downstream);
	graph.edges.push({
		id: crypto.randomUUID(),
		source: node.id,
		target: downstream.id,
		sourceHandle: "output",
		targetHandle: "script",
	});
	node.data.selectedRunId = first.id;
	await db.setGraph(projectId, graph);
	const queued = await queue(downstream);
	expect((await db.store.get(queued.id))?.prompt).toBe(
		"Version one\n\nClosing words",
	);
	node.data.selectedRunId = null;
	node.data.content = "Edited again";
	await db.setGraph(projectId, graph);
	expect((await db.store.get(queued.id))?.prompt).toBe(
		"Version one\n\nClosing words",
	);
});

it("does not fall back from an invalid selected output or restore a guessed legacy prompt", async () => {
	const runId = crypto.randomUUID();
	await db.store.claim({
		id: runId,
		projectId,
		nodeId: node.id,
		userId: "owner",
		modelId: "amazon/nova-micro",
		prompt: "Combined context and task",
		inputHash: "a".repeat(64),
		credits: 1,
	});
	await db.store.start(runId);
	await db.store.finish(runId, {
		output: "Legacy",
		inputTokens: 1,
		outputTokens: 1,
	});
	expect(
		(await service().history("owner", { projectId, nodeId: node.id })).runs[0]
			?.settings,
	).toBeNull();
	await expect(
		service().historyAction("owner", {
			projectId,
			nodeId: node.id,
			runId,
			action: "restore",
		}),
	).rejects.toThrow("no authored settings snapshot");
	node.data.selectedRunId = crypto.randomUUID();
	const target = createCanvasNode("image", { x: 100, y: 0 });
	graph.nodes.push(target);
	graph.edges.push({
		id: crypto.randomUUID(),
		source: node.id,
		target: target.id,
		sourceHandle: "output",
		targetHandle: "prompt",
	});
	await db.setGraph(projectId, graph);
	const balance = await db.store.balance("owner");
	await expect(queue(target)).rejects.toThrow(
		"historical output is unavailable",
	);
	expect(await db.store.balance("owner")).toBe(balance);
});

it("keeps deleted-node records readable and rejects applying them to a deleted node", async () => {
	const run = await success();
	graph.nodes = [];
	await db.setGraph(projectId, graph);
	expect(
		(await service().history("viewer", { projectId, nodeId: node.id })).runs,
	).toHaveLength(1);
	await expect(
		service().historyAction("owner", {
			projectId,
			nodeId: node.id,
			runId: run.id,
			action: "select",
		}),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("keeps unavailable media inspectable but refuses selecting it", async () => {
	node.type = "image";
	await db.setGraph(projectId, graph);
	const run = await success();
	const unavailable = createGenerationService(
		db.store,
		projects(),
		{ textConfigured: true, imageConfigured: true, dispatch },
		{ get: async () => null },
	);
	const page = await unavailable.history("viewer", {
		projectId,
		nodeId: node.id,
	});
	expect(page.runs[0]).toMatchObject({
		id: run.id,
		mediaAvailable: false,
		creditState: "charged",
	});
	await expect(
		unavailable.historyAction("owner", {
			projectId,
			nodeId: node.id,
			runId: run.id,
			action: "select",
		}),
	).rejects.toThrow("media is unavailable");
});
