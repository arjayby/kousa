import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { defaultTextModel } from "../src/contracts";
import { graphFreshness } from "../src/freshness";
import { buildPrompt, textInputHash, textInputSnapshot } from "../src/input";
import type { TextProvider } from "../src/service";
import { inlineService } from "./helpers";

let database: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let graph: CanvasDocument;
const node = () => {
	const n = createCanvasNode("text", { x: 0, y: 0 });
	n.data.content = "Write a short greeting.";
	return n;
};
let target = node();
const generate = vi.fn<TextProvider["generate"]>();
const response = { output: "Hello!", inputTokens: 10, outputTokens: 2 };
const provider: TextProvider = { configured: true, generate };
const projects = () =>
	createProjectService(database.projects, {
		appUrl: "https://example.test",
		email: {
			isConfigured: () => false,
			send: async () => ({ messageId: null }),
		},
	});
const service = () => inlineService(database.store, projects(), provider);
const input = async (nodeId = target.id) => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId,
	inputHash: await textInputHash(graph, nodeId),
});
const reservation = (
	id = crypto.randomUUID(),
	nodeId = target.id,
	userId = "owner",
) => ({
	id,
	nodeId,
	userId,
	projectId,
	modelId: defaultTextModel,
	prompt: "Hello",
	inputHash: "a".repeat(64),
	credits: 1,
});
beforeAll(async () => {
	database = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await database.close();
});
beforeEach(async () => {
	projectId = await database.reset();
	target = node();
	graph = { version: 1, nodes: [target], edges: [] };
	await database.setGraph(projectId, graph);
	await database.grant("owner");
	generate.mockReset().mockResolvedValue(response);
	provider.configured = true;
});

describe("generation and credit ledger", () => {
	it.each([
		[undefined, "amazon/nova-micro"],
		["openai/gpt-4.1-mini", "openai/gpt-4.1-mini"],
		["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash-lite"],
		["amazon/nova-micro", "amazon/nova-micro"],
		["amazon/nova-lite", "amazon/nova-lite"],
	])(
		"preserves saved model %s as %s without silently changing providers",
		async (saved, expected) => {
			await database.grant("owner", 10);
			target.data.textModel = saved;
			await database.setGraph(projectId, graph);
			const run = await service().generate("owner", await input());
			expect(run.modelId).toBe(expected);
			expect(generate).toHaveBeenCalledWith(
				expect.objectContaining({ modelId: expected }),
			);
		},
	);
	it("saves a result, spends one credit, and replays the same request without another call", async () => {
		const request = await input();
		const run = await service().generate("owner", request);
		expect(run).toMatchObject({
			status: "succeeded",
			output: "Hello!",
			credits: 1,
		});
		expect(await service().generate("owner", request)).toEqual(run);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(await database.credits.summary("owner")).toEqual({ balance: 0 });
		await expect(
			service().generate("owner", await input()),
		).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
	});
	it("charges the editor who runs it, leaving the owner's credits intact", async () => {
		await expect(
			service().generate("editor", await input()),
		).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
		await database.grant("editor");
		await service().generate("editor", await input());
		expect(await database.store.balance("editor")).toBe(0);
		expect(await database.store.balance("owner")).toBe(1);
	});
	it("viewers can read results, but cannot run; outsiders cannot read or run", async () => {
		await service().generate("owner", await input());
		expect(
			(await service().list("viewer", { projectId })).runs[0]?.output,
		).toBe("Hello!");
		await expect(
			service().generate("viewer", await input()),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			service().list("outsider", { projectId }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			service().generate("outsider", await input()),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
	it("rechecks editor permissions in the atomic reservation", async () => {
		await database.grant("editor");
		await database.revoke("editor");
		expect(
			await database.store.claim(
				reservation(crypto.randomUUID(), target.id, "editor"),
			),
		).toMatchObject({ error: "FORBIDDEN" });
		expect(await database.store.balance("editor")).toBe(1);
	});
	it("reserves immediately, prevents competing runs and idempotent concurrent calls", async () => {
		let resolve!: (v: typeof response) => void;
		generate.mockImplementation(
			() =>
				new Promise((r) => {
					resolve = r;
				}),
		);
		const request = await input();
		const pending = service().generate("owner", request);
		await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
		expect(await database.store.balance("owner")).toBe(0);
		expect((await service().generate("owner", request)).status).toBe("running");
		await expect(
			service().generate("owner", await input()),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await database.grant("editor");
		await expect(
			service().generate("editor", await input()),
		).rejects.toMatchObject({ code: "CONFLICT" });
		resolve(response);
		await pending;
		expect(generate).toHaveBeenCalledTimes(1);
	});
	it("serializes concurrent reservations across nodes so a balance cannot be overspent", async () => {
		const claims = await Promise.all(
			Array.from({ length: 8 }, () =>
				database.store.claim(
					reservation(crypto.randomUUID(), crypto.randomUUID()),
				),
			),
		);
		expect(claims.filter((c) => c.claimed)).toHaveLength(1);
		expect(await database.store.balance("owner")).toBe(0);
	});
	it("rejects another actor's reused request ID", async () => {
		const request = await input();
		await service().generate("owner", request);
		await expect(service().generate("editor", request)).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});
	it.each(["provider", "empty"])(
		"releases credits exactly once after %s failure",
		async (failure) => {
			if (failure === "provider")
				generate.mockRejectedValue(new Error("secret provider detail"));
			else generate.mockResolvedValue({ ...response, output: " " });
			const request = await input();
			const run = await service().generate("owner", request);
			expect(run.status).toBe("failed");
			expect(run.error).not.toContain("secret");
			expect(await database.store.balance("owner")).toBe(1);
			await service().generate("owner", request);
			expect(generate).toHaveBeenCalledTimes(1);
			expect(await database.store.finish(request.id, response)).toBeNull();
			expect(await database.store.balance("owner")).toBe(1);
		},
	);
	it("releases abandoned runs and refuses a late success after lease expiry", async () => {
		const r = reservation();
		await database.store.claim(r);
		await database.expire(r.id);
		expect(await database.store.balance("owner")).toBe(1);
		expect(await database.store.finish(r.id, response)).toBeNull();
		const listed = await service().list("viewer", { projectId });
		expect(listed.runs[0]?.status).toBe("failed");
		await service().generate("owner", await input());
		expect(await database.store.balance("owner")).toBe(0);
	});
	it("does not repeat the provider call if result persistence fails", async () => {
		const request = await input();
		const store = {
			...database.store,
			finish: vi.fn().mockRejectedValue(new Error("Database offline")),
		};
		await expect(
			inlineService(store, projects(), provider).generate("owner", request),
		).resolves.toMatchObject({ status: "running" });
		expect((await service().generate("owner", request)).status).toBe("running");
		expect(generate).toHaveBeenCalledTimes(1);
	});
	it("rejects unavailable configuration, invalid models and stale graph before reserving", async () => {
		provider.configured = false;
		await expect(
			service().generate("owner", await input()),
		).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
		provider.configured = true;
		const stale = await input();
		target.data.content = "Changed";
		await database.setGraph(projectId, graph);
		await expect(service().generate("owner", stale)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		target.data.textModel = "unapproved/expensive";
		await database.setGraph(projectId, graph);
		await expect(
			service().generate("owner", await input()),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(generate).not.toHaveBeenCalled();
		expect(await database.store.balance("owner")).toBe(1);
	});
	it("uses server-owned upstream output, falling back to source text before its first result", async () => {
		const source = node();
		source.data.content = "Source text";
		graph.nodes.push(source);
		graph.edges.push({
			id: crypto.randomUUID(),
			source: source.id,
			target: target.id,
			sourceHandle: "output",
			targetHandle: "context",
		});
		await database.setGraph(projectId, graph);
		await database.grant("owner", 2);
		await service().generate("owner", await input());
		expect(generate.mock.calls[0]?.[0].prompt).toContain("Source text");
		await service().generate("owner", await input(source.id));
		await service().generate("owner", await input());
		expect(generate.mock.calls[2]?.[0].prompt).toContain("Hello!");
		expect(generate.mock.calls[2]?.[0].prompt).not.toContain("Source text");
	});
	it("bounds input bytes including upstream context, rejects empty prompts and media inputs", () => {
		target.data.content = "😀".repeat(3_001);
		expect(() => buildPrompt(textInputSnapshot(graph, target.id), [])).toThrow(
			"12 KB",
		);
		target.data.content = " ";
		expect(() => buildPrompt(textInputSnapshot(graph, target.id), [])).toThrow(
			"Write a prompt",
		);
		const source = createCanvasNode("image", { x: 0, y: 0 });
		graph.nodes.push(source);
		graph.edges.push({
			id: crypto.randomUUID(),
			source: source.id,
			target: target.id,
			sourceHandle: "output",
			targetHandle: "context",
		});
		expect(() => textInputSnapshot(graph, target.id)).toThrow(
			"does not accept image context",
		);
	});
});

it("captures standalone resolved text references for later workflow reuse", async () => {
	await database.grant("owner", 2);
	const source = node();
	graph.nodes.push(source);
	graph.edges.push({
		id: crypto.randomUUID(),
		source: source.id,
		target: target.id,
		sourceHandle: "output",
		targetHandle: "context",
	});
	await database.setGraph(projectId, graph);
	const upstream = await service().generate("owner", await input(source.id));
	const downstream = await service().generate("owner", await input());
	expect(downstream.resolvedInputs?.text).toEqual([
		{ nodeId: source.id, runId: upstream.id, content: upstream.output },
	]);
	expect(
		graphFreshness(graph, [upstream, downstream]).get(target.id)?.state,
	).toBe("current");
	source.data.content = "Updated source";
	expect(
		graphFreshness(graph, [upstream, downstream]).get(target.id)?.state,
	).toBe("outdated");
});

it("isolates outputs and node history even when canvases contain the same node ID", async () => {
	const second = await projects().createCanvas("owner", {
		projectId,
		name: "Second",
	});
	await projects().saveCanvas("owner", {
		projectId,
		canvasId: second.id,
		document: graph,
		expectedRevision: 0,
	});
	const request = { ...(await input()), canvasId: second.id };
	const run = await service().generate("owner", request);
	expect(run.status).toBe("succeeded");
	expect((await database.store.get(run.id))?.canvasId).toBe(second.id);
	expect((await service().list("viewer", { projectId })).runs).toEqual([]);
	expect(
		(
			await service().list("viewer", { projectId, canvasId: second.id })
		).runs.map((r) => r.id),
	).toEqual([run.id]);
	expect(
		(await service().history("viewer", { projectId, nodeId: target.id })).runs,
	).toEqual([]);
	expect(
		(
			await service().history("viewer", {
				projectId,
				canvasId: second.id,
				nodeId: target.id,
			})
		).runs,
	).toHaveLength(1);
	await expect(
		service().generate("owner", { ...request, canvasId: projectId }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	await expect(
		service().historyAction("owner", {
			projectId,
			nodeId: target.id,
			runId: run.id,
			action: "select",
		}),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(
		await service().historyAction("owner", {
			projectId,
			canvasId: second.id,
			nodeId: target.id,
			runId: run.id,
			action: "select",
		}),
	).toMatchObject({ patch: { selectedRunId: run.id } });
});
