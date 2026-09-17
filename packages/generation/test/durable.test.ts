import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { generationInputHash } from "../src/input";
import type { TextProvider } from "../src/providers";
import { createGenerationRunner } from "../src/runner";
import { createGenerationService } from "../src/service";
import { type DurableSteps, executeGenerationWorkflow } from "../src/workflow";
import {
	inlineSteps,
	memoryArtifacts,
	unavailableImage,
	unavailableMedia,
} from "./helpers";

let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let graph: CanvasDocument;
let node = createCanvasNode("text", { x: 0, y: 0 });
let artifacts = memoryArtifacts();
const output = { output: "Saved result", inputTokens: 12, outputTokens: 4 };
const generate = vi.fn<TextProvider["generate"]>();
const dispatch = vi.fn<(id: string) => Promise<void>>();
const provider = { configured: true, generate };
const runner = (store = db.store) =>
	createGenerationRunner(
		store,
		artifacts,
		provider,
		unavailableImage,
		unavailableMedia,
	);
const service = () =>
	createGenerationService(
		db.store,
		createProjectService(db.projects, {
			appUrl: "https://example.test",
			email: {
				isConfigured: () => false,
				send: async () => ({ messageId: null }),
			},
		}),
		{ textConfigured: true, imageConfigured: false, dispatch },
	);
const request = async () => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId: node.id,
	inputHash: await generationInputHash(graph, node.id),
});

beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	node = createCanvasNode("text", { x: 0, y: 0 });
	node.data.content = "Original prompt";
	graph = { version: 1, nodes: [node], edges: [] };
	await db.setGraph(projectId, graph);
	await db.grant("owner", 5);
	artifacts = memoryArtifacts();
	generate.mockReset().mockResolvedValue(output);
	dispatch.mockReset().mockResolvedValue(undefined);
});

it("returns queued immediately, reserves credits and exposes shared status without calling AI", async () => {
	const input = await request();
	expect(await service().generate("owner", input)).toMatchObject({
		status: "queued",
		stage: "queued",
		output: null,
	});
	expect(generate).not.toHaveBeenCalled();
	expect(dispatch).toHaveBeenCalledWith(input.id);
	expect(await db.store.balance("owner")).toBe(4);
	expect((await service().list("viewer", { projectId })).runs[0]?.status).toBe(
		"queued",
	);
	await expect(
		service().generate("owner", await request()),
	).rejects.toMatchObject({ code: "CONFLICT" });
	await service().generate("owner", input);
	expect(await db.store.pending()).toEqual([{ id: input.id }]);
	expect(await db.store.balance("owner")).toBe(4);
});

it("recovers a lost dispatch from the durable outbox and uses the original prompt snapshot", async () => {
	dispatch.mockRejectedValue(new Error("worker unreachable"));
	const input = await request();
	expect((await service().generate("owner", input)).status).toBe("queued");
	node.data.content = "Edited while queued";
	await db.setGraph(projectId, graph);
	for (const pending of await db.store.pending())
		await executeGenerationWorkflow(pending.id, runner(), inlineSteps);
	expect(generate).toHaveBeenCalledExactlyOnceWith({
		modelId: "amazon/nova-micro",
		prompt: "Original prompt",
	});
	expect(await db.store.get(input.id)).toMatchObject({
		status: "succeeded",
		output: output.output,
	});
	expect(await db.store.pending()).toEqual([]);
	expect(await db.store.balance("owner")).toBe(4);
});

it("resumes from a provider receipt after a worker restart without another paid call", async () => {
	const input = await request();
	await service().generate("owner", input);
	expect(await runner().generate(input.id)).toBe(true);
	expect(await db.store.get(input.id)).toMatchObject({
		status: "running",
		stage: "generating",
	});
	// A new runner has no in-memory knowledge of the old execution or checkpoint.
	await executeGenerationWorkflow(input.id, runner(), inlineSteps);
	expect(generate).toHaveBeenCalledTimes(1);
	expect(await db.store.get(input.id)).toMatchObject({
		status: "succeeded",
		output: output.output,
	});
	expect(await artifacts.get(input.id)).toBeNull();
	await executeGenerationWorkflow(input.id, runner(), inlineSteps);
	expect(generate).toHaveBeenCalledTimes(1);
	expect(await db.store.balance("owner")).toBe(4);
});

it("allows only one execution to cross the provider boundary", async () => {
	const input = await request();
	await service().generate("owner", input);
	let resolve!: (value: typeof output) => void;
	generate.mockImplementation(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const first = runner().generate(input.id);
	await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
	await expect(runner().generate(input.id)).rejects.toThrow(
		"Waiting to recover",
	);
	resolve(output);
	await first;
	await executeGenerationWorkflow(input.id, runner(), inlineSteps);
	expect(generate).toHaveBeenCalledTimes(1);
	expect((await db.store.get(input.id))?.status).toBe("succeeded");
});

it("releases an ambiguous interrupted provider call instead of invoking it again", async () => {
	const input = await request();
	await service().generate("owner", input);
	await db.store.start(input.id);
	await expect(runner().generate(input.id)).rejects.toThrow(
		"Waiting to recover",
	);
	await db.interrupt(input.id);
	await executeGenerationWorkflow(input.id, runner(), inlineSteps);
	expect(generate).not.toHaveBeenCalled();
	expect((await db.store.get(input.id))?.status).toBe("failed");
	expect(await db.store.balance("owner")).toBe(5);
});

it("recovers an uncertain receipt write using the saved bytes", async () => {
	const input = await request();
	await service().generate("owner", input);
	const put = artifacts.put;
	artifacts.put = vi.fn(async (id, value) => {
		await put(id, value);
		throw new Error("Lost storage response");
	});
	await expect(runner().generate(input.id)).rejects.toThrow(
		"Could not confirm",
	);
	await executeGenerationWorkflow(input.id, runner(), inlineSteps);
	expect(generate).toHaveBeenCalledTimes(1);
	expect((await db.store.get(input.id))?.status).toBe("succeeded");
});

it("retries publishing safely when a successful database commit loses its response", async () => {
	const input = await request();
	await service().generate("owner", input);
	const finish = vi.fn(async (...args: Parameters<typeof db.store.finish>) => {
		await db.store.finish(...args);
		throw new Error("Lost commit response");
	});
	const attempts = new Map<string, number>();
	const retrySteps: DurableSteps = {
		sleep: async () => {},
		async do(name, options, callback) {
			for (let attempt = 0; ; attempt++) {
				attempts.set(name, attempt + 1);
				try {
					return await callback();
				} catch (error) {
					if (attempt >= options.retries.limit) throw error;
				}
			}
		},
	};
	await executeGenerationWorkflow(
		input.id,
		runner({ ...db.store, finish }),
		retrySteps,
	);
	expect(attempts.get("publish-and-charge")).toBe(2);
	expect(finish).toHaveBeenCalledTimes(1);
	expect(generate).toHaveBeenCalledTimes(1);
	expect((await db.store.get(input.id))?.status).toBe("succeeded");
	expect(await db.store.balance("owner")).toBe(4);
});

it.each(["queued", "saved"])(
	"releases an expired %s job and refuses late execution or charging",
	async (state) => {
		const input = await request();
		await service().generate("owner", input);
		if (state === "saved") await runner().generate(input.id);
		await db.expire(input.id);
		await executeGenerationWorkflow(input.id, runner(), inlineSteps);
		expect(generate).toHaveBeenCalledTimes(state === "saved" ? 1 : 0);
		expect((await db.store.get(input.id))?.status).toBe("failed");
		expect(await db.store.balance("owner")).toBe(5);
		expect(await artifacts.get(input.id)).toBeNull();
	},
);

it.each(["queued", "saved"])(
	"rechecks editor access for %s jobs and never charges revoked editors",
	async (state) => {
		await db.grant("editor", 2);
		const input = await request();
		await service().generate("editor", input);
		if (state === "saved") await runner().generate(input.id);
		await db.revoke("editor");
		await executeGenerationWorkflow(input.id, runner(), inlineSteps);
		expect(generate).toHaveBeenCalledTimes(state === "saved" ? 1 : 0);
		expect((await db.store.get(input.id))?.status).toBe("failed");
		expect(await db.store.balance("editor")).toBe(2);
		expect(await db.store.balance("owner")).toBe(5);
	},
);
