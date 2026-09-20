import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createCanvasNode, emptyCanvas } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
	type ChatPlan,
	insertChatProposal,
	parseChatPlan,
} from "../src/canvas-chat";
import { createCanvasChatService } from "../src/canvas-chat-service";
import { planGraph } from "../src/graph-plan";
import type { TextProvider } from "../src/providers";

const plan: ChatPlan = {
	message: "A creative direction connected to an ad image.",
	nodes: [
		{
			key: "brief",
			kind: "text",
			label: "Ad direction",
			prompt: "Write a visual direction for an ad for a matcha drink.",
			aspectRatio: "1:1",
			duration: 5,
		},
		{
			key: "image",
			kind: "image",
			label: "Ad image",
			prompt: "Create a product image using the connected direction.",
			aspectRatio: "1:1",
			duration: 5,
		},
	],
	edges: [{ source: "brief", target: "image", port: "prompt" }],
};
const parse = (value: unknown) => parseChatPlan(JSON.stringify(value));

it("creates executable text-to-image proposals with a cost and connected layout", async () => {
	const proposal = await parse(plan);
	expect(proposal.credits).toBe(4);
	expect(proposal.targetIds).toEqual([proposal.graph.nodes[1]?.id]);
	expect(proposal.graph.nodes[1]?.position.x).toBe(400);
	expect(proposal.graph.nodes[0]?.data).not.toHaveProperty("assetId");
	const execution = await planGraph(proposal.graph, proposal.targetIds);
	expect(execution.plan.map((step) => step.kind)).toEqual(["text", "image"]);
});

it("handles clarification replies and rejects malformed or unsafe model proposals", async () => {
	expect(
		(
			await parse({
				message: "What product is the ad for?",
				nodes: [],
				edges: [],
			})
		).graph.nodes,
	).toEqual([]);
	await expect(
		parse({ ...plan, nodes: [...plan.nodes, plan.nodes[0]] }),
	).rejects.toThrow();
	await expect(
		parse({
			...plan,
			nodes: Array.from({ length: 9 }, (_, i) => ({
				...plan.nodes[0],
				key: `n${i}`,
			})),
		}),
	).rejects.toThrow();
	await expect(
		parse({
			...plan,
			nodes: [{ ...plan.nodes[0], assetId: crypto.randomUUID() }],
		}),
	).rejects.toThrow();
	await expect(
		parse({
			...plan,
			edges: [{ source: "image", target: "brief", port: "context" }],
		}),
	).rejects.toThrow("unsupported");
	await expect(
		parse({
			...plan,
			nodes: plan.nodes.map((node) => ({ ...node, kind: "text" })),
			edges: [
				{ source: "brief", target: "image", port: "context" },
				{ source: "image", target: "brief", port: "context" },
			],
		}),
	).rejects.toThrow();
	await expect(
		parse({
			...plan,
			edges: [
				{ source: "existing_canvas_node", target: "image", port: "prompt" },
			],
		}),
	).rejects.toThrow();
	await expect(parseChatPlan("not JSON")).rejects.toThrow();
	await expect(parseChatPlan("x".repeat(24_001))).rejects.toThrow();
});

it("plans video and speech branches with shared text generated once", async () => {
	const proposal = await parse({
		...plan,
		nodes: [
			...plan.nodes,
			{
				key: "video",
				kind: "video",
				label: "Video",
				prompt: "Slow camera push toward the matcha drink.",
				aspectRatio: "9:16",
				duration: 5,
			},
			{
				key: "speech",
				kind: "speech",
				label: "Narration",
				prompt: "",
				aspectRatio: "1:1",
				duration: 5,
			},
		],
		edges: [
			...plan.edges,
			{ source: "image", target: "video", port: "image" },
			{ source: "brief", target: "speech", port: "script" },
		],
	});
	expect(proposal.targetIds).toHaveLength(2);
	expect(proposal.credits).toBe(16);
	expect(
		(await planGraph(proposal.graph, proposal.targetIds)).plan
			.map((step) => step.kind)
			.sort(),
	).toEqual(["image", "speech", "text", "video"]);
});

it("inserts saved IDs once, preserves existing work, and rechecks canvas limits", async () => {
	const proposal = await parse(plan);
	const original = {
		...emptyCanvas(),
		nodes: [createCanvasNode("text", { x: 0, y: 0 })],
	};
	const next = insertChatProposal(original, proposal);
	expect(next.nodes[0]).toEqual(original.nodes[0]);
	expect(next.nodes.slice(1).map((node) => node.id)).toEqual(
		proposal.graph.nodes.map((node) => node.id),
	);
	expect(next.nodes[1]?.position.x).toBe(400);
	await expect(
		Promise.resolve().then(() => insertChatProposal(next, proposal)),
	).rejects.toThrow("already on");
	expect(() =>
		insertChatProposal(
			{
				...emptyCanvas(),
				nodes: Array.from({ length: 199 }, () =>
					createCanvasNode("text", { x: 0, y: 0 }),
				),
			},
			proposal,
		),
	).toThrow("canvas limit");
	expect(original.nodes).toHaveLength(1);
});

let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
const generate = vi.fn<TextProvider["generate"]>(async () => ({
	output: JSON.stringify(plan),
	inputTokens: 10,
	outputTokens: 20,
}));
const projects = () =>
	createProjectService(db.projects, {
		appUrl: "https://example.test",
		email: {
			isConfigured: () => false,
			send: async () => ({ messageId: null }),
		},
	});
const service = () =>
	createCanvasChatService(db.chat, projects(), { configured: true, generate });
const request = () => ({
	id: crypto.randomUUID(),
	projectId,
	canvasId: projectId,
	message: "Write an ad direction, then generate an image.",
	previousId: null,
});
beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	await projects().getCanvas("owner", { projectId });
	generate.mockReset();
	generate.mockResolvedValue({
		output: JSON.stringify(plan),
		inputTokens: 10,
		outputTokens: 20,
	});
});

it("persists a private proposal without charging or editing the shared canvas", async () => {
	const input = request();
	const reply = await service().compose("owner", input);
	expect(reply.status).toBe("succeeded");
	expect(reply.proposal?.credits).toBe(4);
	expect((await service().history("owner", input)).replies).toEqual([reply]);
	expect((await service().history("editor", input)).replies).toEqual([]);
	expect((await projects().getCanvas("owner", input)).document.nodes).toEqual(
		[],
	);
	expect(await db.store.balance("owner")).toBe(0);
	expect(await service().compose("owner", input)).toEqual(reply);
	expect(generate).toHaveBeenCalledTimes(1);
	await expect(
		service().compose("owner", { ...input, message: "Changed request" }),
	).rejects.toMatchObject({ code: "CONFLICT" });
});

it("requires edit access and rejects another person's or canvas's conversation", async () => {
	const input = request();
	await expect(service().compose("viewer", input)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(service().compose("outsider", input)).rejects.toThrow();
	await expect(service().history("viewer", input)).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	expect(generate).not.toHaveBeenCalled();
	const reply = await service().compose("owner", input);
	await expect(
		service().compose("editor", { ...request(), previousId: reply.id }),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	await expect(
		service().compose("owner", {
			...request(),
			canvasId: crypto.randomUUID(),
			previousId: reply.id,
		}),
	).rejects.toThrow();
	const refined = await service().compose("owner", {
		...request(),
		message: "Make it vertical",
		previousId: reply.id,
	});
	expect(refined.status).toBe("succeeded");
	expect(generate.mock.calls.at(-1)?.[0].prompt).toContain("Make it vertical");
	expect(generate.mock.calls.at(-1)?.[0].prompt).toContain("Ad direction");
});

it("fails invalid model output without changes and can recover with a new request", async () => {
	generate.mockResolvedValueOnce({
		output: "oops",
		inputTokens: 1,
		outputTokens: 1,
	});
	const input = request();
	expect((await service().compose("owner", input)).status).toBe("failed");
	expect((await service().compose("owner", input)).status).toBe("failed");
	expect(generate).toHaveBeenCalledTimes(1);
	expect((await service().compose("owner", request())).status).toBe(
		"succeeded",
	);
});

it("serializes concurrent submissions and retries without duplicate provider calls", async () => {
	let release: (() => void) | undefined;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	generate.mockImplementationOnce(async () => {
		await blocked;
		return { output: JSON.stringify(plan), inputTokens: 1, outputTokens: 1 };
	});
	const input = request();
	const first = service().compose("owner", input);
	await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
	expect((await service().compose("owner", input)).status).toBe("running");
	await expect(service().compose("owner", request())).rejects.toMatchObject({
		code: "CONFLICT",
	});
	release?.();
	expect((await first).status).toBe("succeeded");
	expect(generate).toHaveBeenCalledOnce();
});

it("enforces the persistent hourly quota across requests", async () => {
	for (let i = 0; i < 20; i++) await service().compose("owner", request());
	await expect(service().compose("owner", request())).rejects.toThrow(
		"20 chat requests",
	);
	expect(generate).toHaveBeenCalledTimes(20);
});

it("recovers abandoned requests and refuses late completion", async () => {
	const input = request();
	expect(await db.chat.claim({ ...input, userId: "owner" })).toEqual({
		claimed: true,
	});
	await db.expireChat(input.id);
	expect((await service().history("owner", input)).replies[0]?.status).toBe(
		"failed",
	);
	await db.chat.finish(input.id, { proposal: await parse(plan) });
	expect((await service().compose("owner", input)).status).toBe("failed");
	expect(generate).not.toHaveBeenCalled();
	expect((await service().compose("owner", request())).status).toBe(
		"succeeded",
	);
});

it("discards the proposal if editing access is revoked during the provider call", async () => {
	generate.mockImplementationOnce(async () => {
		await db.revoke("editor");
		return { output: JSON.stringify(plan), inputTokens: 1, outputTokens: 1 };
	});
	const input = request();
	await expect(service().compose("editor", input)).rejects.toThrow();
	expect(await db.chat.get(input.id)).toMatchObject({
		status: "failed",
		proposal: null,
	});
});
