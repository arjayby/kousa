import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaHandler } from "@kousa/media/http";
import { createMediaService } from "@kousa/media/service";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
	defaultSpeechModel,
	defaultSpeechVoice,
	speechVoices,
} from "../src/contracts";
import { planGraph } from "../src/graph-plan";
import { createGraphService } from "../src/graph-service";
import { executeGraphWorkflow } from "../src/graph-workflow";
import type { SpeechProvider, TextProvider } from "../src/providers";
import { createGenerationRunner } from "../src/runner";
import { createGenerationService } from "../src/service";
import { executeGenerationWorkflow } from "../src/workflow";
import { inlineSteps, memoryArtifacts, unavailableImage } from "./helpers";

const audio = new Uint8Array(
	readFileSync(new URL("../../media/test/fixtures/tone.mp3", import.meta.url)),
);
let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let graph: CanvasDocument;
let textNode = createCanvasNode("text", { x: 0, y: 0 });
let speechNode = createCanvasNode("speech", { x: 300, y: 0 });
let media: ReturnType<typeof createMediaService>;
let artifacts = memoryArtifacts();
const objects = new Map<string, Uint8Array<ArrayBuffer>>();
const text = vi.fn<TextProvider["generate"]>();
const speech = vi.fn<SpeechProvider["generate"]>();
const dispatch = vi.fn(async (_id: string) => {});
const connect = (source: string, target: string, targetHandle = "script") => ({
	id: crypto.randomUUID(),
	source,
	target,
	targetHandle,
	sourceHandle: "output" as const,
});
const projects = () =>
	createProjectService(db.projects, {
		appUrl: "https://kousa.app",
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
		unavailableImage,
		media,
		{ configured: true, generate: speech },
	);
const execute = (id: string) =>
	executeGraphWorkflow(id, db.graphs, db.store, runner(), inlineSteps);
const request = async () => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId: speechNode.id,
	mode: "force" as const,
	inputHash: (
		await service().preview("owner", {
			projectId,
			nodeId: speechNode.id,
			mode: "force",
		})
	).inputHash,
});
async function finishText(id: string) {
	const flow = await db.graphs.get(id);
	const first = flow?.plan[0];
	if (!first) throw new Error("Missing text step");
	expect(await db.graphs.begin(id, 0, first.content)).toBe(true);
	await executeGenerationWorkflow(first.runId, runner(), inlineSteps);
	return flow;
}

beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	await db.grant("owner", 20);
	textNode = createCanvasNode("text", { x: 0, y: 0 });
	textNode.data.content = "Write a short narration about a quiet street.";
	speechNode = createCanvasNode("speech", { x: 300, y: 0 });
	speechNode.data.content = "Welcome to Kousa.";
	speechNode.data.voiceDirection = "Warm and calm";
	graph = {
		version: 1,
		nodes: [textNode, speechNode],
		edges: [connect(textNode.id, speechNode.id)],
	};
	await db.setGraph(projectId, graph);
	objects.clear();
	artifacts = memoryArtifacts();
	dispatch.mockClear();
	text.mockReset().mockResolvedValue({
		output: "Lanterns glow along the quiet street.",
		inputTokens: 1,
		outputTokens: 1,
	});
	speech
		.mockReset()
		.mockResolvedValue({ bytes: audio, mimeType: "audio/mpeg" });
	media = createMediaService(db.media, db.projects, {
		put: async (key, bytes) => {
			objects.set(key, bytes);
		},
		get: async (key, range) => {
			const full = objects.get(key);
			if (!full) return null;
			const bytes = range
				? full.slice(range.offset, range.offset + range.length)
				: full;
			return {
				bytes: bytes.length,
				body: new Response(bytes).body as ReadableStream,
			};
		},
	});
});

it("quotes Text → Speech and invalidates previews when voice or direction changes", async () => {
	for (const change of [
		{ voiceId: speechVoices[1].id },
		{ voiceDirection: "Excited" },
	]) {
		const input = await request();
		const preview = await service().preview("owner", input);
		expect(preview).toMatchObject({ credits: 3, balance: 20, blockers: [] });
		expect(preview.steps.map((step) => [step.kind, step.credits])).toEqual([
			["text", 1],
			["speech", 2],
		]);
		expect(preview.steps[1]?.speech).toEqual({
			voiceId: speechNode.data.voiceId ?? defaultSpeechVoice,
			voiceDirection: speechNode.data.voiceDirection,
		});
		Object.assign(speechNode.data, change);
		await db.setGraph(projectId, graph);
		await expect(service().start("owner", input)).rejects.toMatchObject({
			code: "CONFLICT",
		});
	}
	expect(await db.store.balance("owner")).toBe(20);
	expect(dispatch).not.toHaveBeenCalled();
});

it("uses exact new text and frozen speech settings, publishes private audio, and charges once", async () => {
	const input = await request();
	await service().start("owner", input);
	await service().start("owner", input);
	expect(await db.store.balance("owner")).toBe(17);
	textNode.data.content = "Changed while queued";
	speechNode.data.content = "Changed script";
	speechNode.data.voiceId = speechVoices[1].id;
	speechNode.data.voiceDirection = "Excited";
	graph.edges = [];
	await db.setGraph(projectId, graph);
	await execute(input.id);
	await execute(input.id);
	expect(text).toHaveBeenCalledTimes(1);
	expect(speech).toHaveBeenCalledTimes(1);
	expect(speech).toHaveBeenCalledWith({
		modelId: defaultSpeechModel,
		voiceId: defaultSpeechVoice,
		voiceDirection: "Warm and calm",
		text: "Lanterns glow along the quiet street.\n\nWelcome to Kousa.",
	});
	expect((await db.graphs.get(input.id))?.status).toBe("succeeded");
	expect(await db.store.balance("owner")).toBe(17);
	expect(await db.credits.summary("owner")).toEqual({ balance: 17 });
	const generations = createGenerationService(db.store, projects(), {
		textConfigured: true,
		imageConfigured: false,
		speechConfigured: true,
		dispatch,
	});
	const [result] = (await generations.list("viewer", { projectId }))
		.speechResults;
	expect(result).toMatchObject({
		status: "succeeded",
		transcript: "Lanterns glow along the quiet street.\n\nWelcome to Kousa.",
		voiceId: defaultSpeechVoice,
		credits: 2,
	});
	if (!result?.assetId) throw new Error("Missing audio result");
	const response = await createMediaHandler({
		actor: async () => "viewer",
		service: () => media,
	})(new Request("https://kousa.app/media"), {
		projectId,
		assetId: result.assetId,
	});
	expect(response.status).toBe(200);
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(audio);
	expect(
		(await service().list("viewer", { projectId })).runs[0]?.steps.every(
			(step) => step.status === "succeeded",
		),
	).toBe(true);
});

it("runs standalone speech without an image-delivery origin", async () => {
	graph.edges = [];
	await db.setGraph(projectId, graph);
	const input = await request();
	expect(await service().preview("owner", input)).toMatchObject({
		credits: 2,
		blockers: [],
	});
	await service().start("owner", input);
	await execute(input.id);
	expect(text).not.toHaveBeenCalled();
	expect(speech).toHaveBeenCalledWith(
		expect.objectContaining({ text: "Welcome to Kousa." }),
	);
	expect(await db.store.balance("owner")).toBe(18);
});

it("runs Text → Text → Speech in order and reads the final text verbatim", async () => {
	const second = createCanvasNode("text", { x: 200, y: 0 });
	second.data.content = "Polish the narration";
	graph.nodes.push(second);
	graph.edges = [
		connect(textNode.id, second.id, "context"),
		connect(second.id, speechNode.id),
	];
	await db.setGraph(projectId, graph);
	text
		.mockResolvedValueOnce({
			output: "First narration",
			inputTokens: 1,
			outputTokens: 1,
		})
		.mockResolvedValueOnce({
			output: "Polished narration",
			inputTokens: 1,
			outputTokens: 1,
		});
	const input = await request();
	expect((await service().preview("owner", input)).credits).toBe(4);
	await service().start("owner", input);
	await execute(input.id);
	expect(text).toHaveBeenCalledTimes(2);
	expect(text.mock.calls[1]?.[0].prompt).toContain("First narration");
	expect(speech.mock.calls[0]?.[0].text).toBe(
		"Polished narration\n\nWelcome to Kousa.",
	);
	expect(await db.store.balance("owner")).toBe(16);
});

it("resumes failed speech using the original text, voice and direction despite later outputs and edits", async () => {
	speech.mockRejectedValueOnce(new Error("Speech unavailable"));
	const input = await request();
	await service().start("owner", input);
	await execute(input.id);
	expect((await db.graphs.get(input.id))?.status).toBe("failed");
	expect(await db.store.balance("owner")).toBe(19);
	const original = await db.graphs.get(input.id);
	const unrelated = crypto.randomUUID();
	await db.store.claim({
		id: unrelated,
		projectId,
		nodeId: textNode.id,
		userId: "owner",
		modelId: "amazon/nova-micro",
		prompt: "Later prompt",
		inputHash: "a".repeat(64),
		credits: 1,
	});
	await db.store.start(unrelated);
	await db.store.finish(unrelated, {
		output: "Unrelated newer output",
		inputTokens: 1,
		outputTokens: 1,
	});
	speechNode.data.voiceId = speechVoices[1].id;
	speechNode.data.voiceDirection = "Changed direction";
	speechNode.data.content = "Changed narration";
	await db.setGraph(projectId, graph);
	const resumed = { ...input, id: crypto.randomUUID(), resumeOf: input.id };
	const preview = await service().preview("owner", resumed);
	expect(preview.credits).toBe(2);
	expect(preview.steps.map((step) => step.reused)).toEqual([true, false]);
	expect(preview.steps[1]?.speech).toEqual({
		voiceId: defaultSpeechVoice,
		voiceDirection: "Warm and calm",
	});
	await service().start("owner", resumed);
	await execute(resumed.id);
	const next = await db.graphs.get(resumed.id);
	expect(next?.status).toBe("succeeded");
	expect(next?.plan[0]?.runId).toBe(original?.plan[0]?.runId);
	expect(next?.plan[1]?.runId).not.toBe(original?.plan[1]?.runId);
	expect(text).toHaveBeenCalledTimes(1);
	expect(speech.mock.calls[1]?.[0]).toEqual(speech.mock.calls[0]?.[0]);
	expect(await db.store.balance("owner")).toBe(16);
});

it.each(["receipt", "published"])(
	"recovers speech from a saved %s without another provider call or debit",
	async (mode) => {
		const input = await request();
		await service().start("owner", input);
		const flow = await finishText(input.id);
		const child = flow.plan[1]?.runId;
		if (!child) throw new Error("Missing speech child");
		expect(await db.graphs.begin(input.id, 1, "Saved narration")).toBe(true);
		expect(await runner().generate(child)).toBe(true);
		if (mode === "published")
			await executeGenerationWorkflow(child, runner(), inlineSteps);
		await execute(input.id);
		expect(speech).toHaveBeenCalledTimes(1);
		expect(text).toHaveBeenCalledTimes(1);
		expect((await db.graphs.get(input.id))?.status).toBe("succeeded");
		expect(await db.store.balance("owner")).toBe(17);
		expect(await media.list("viewer", projectId)).toHaveLength(1);
	},
);

it("rejects invalid speech inputs before reserving or dispatching any step", async () => {
	graph.edges = [];
	for (const change of [
		{ content: " " },
		{ content: "a".repeat(1001) },
		{ speechModel: "unknown" },
		{ voiceId: "unknown" },
	]) {
		const previous = { ...speechNode.data };
		Object.assign(speechNode.data, change);
		await db.setGraph(projectId, graph);
		const input = {
			id: crypto.randomUUID(),
			projectId,
			nodeId: speechNode.id,
			inputHash: "a".repeat(64),
		};
		await expect(service().preview("owner", input)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await expect(service().start("owner", input)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		speechNode.data = previous;
	}
	expect(dispatch).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(20);
});

it.each([1000, 1001])(
	"validates %i Unicode characters from the newly generated text before calling speech",
	async (length) => {
		speechNode.data.content = "";
		await db.setGraph(projectId, graph);
		text.mockResolvedValueOnce({
			output: "🌸".repeat(length),
			inputTokens: 1,
			outputTokens: 1,
		});
		const input = await request();
		await service().start("owner", input);
		await execute(input.id);
		expect(speech).toHaveBeenCalledTimes(length === 1000 ? 1 : 0);
		expect(await db.store.balance("owner")).toBe(length === 1000 ? 17 : 19);
		expect((await db.graphs.get(input.id))?.status).toBe(
			length === 1000 ? "succeeded" : "failed",
		);
		if (length > 1000)
			expect((await db.graphs.get(input.id))?.error).toContain(
				"1,000 characters",
			);
	},
);

it("charges the initiating editor, rejects insufficient funds, and keeps viewers read-only", async () => {
	const input = await request();
	await db.grant("editor", 2);
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
	expect(await db.store.balance("owner")).toBe(20);
	expect((await service().list("viewer", { projectId })).runs[0]?.status).toBe(
		"succeeded",
	);
});

it.each(["revoked", "expired"])(
	"releases unfinished speech credits when the workflow is %s after text finishes",
	async (mode) => {
		await db.grant("editor", 3);
		const input = await request();
		await service().start("editor", input);
		await finishText(input.id);
		if (mode === "revoked") await db.revoke("editor");
		else await db.expireGraph(input.id);
		await execute(input.id);
		expect(speech).not.toHaveBeenCalled();
		expect((await db.graphs.get(input.id))?.status).toBe("failed");
		expect(await db.store.balance("editor")).toBe(2);
		expect(await db.store.balance("owner")).toBe(20);
	},
);

it("stops before speech when text fails, then resumes the unfinished plan", async () => {
	text.mockRejectedValueOnce(new Error("Text unavailable"));
	const input = await request();
	await service().start("owner", input);
	await execute(input.id);
	expect(speech).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(20);
	const resumed = { ...input, id: crypto.randomUUID(), resumeOf: input.id };
	expect((await service().preview("owner", resumed)).credits).toBe(3);
	await service().start("owner", resumed);
	await execute(resumed.id);
	expect(speech).toHaveBeenCalledTimes(1);
	expect(await db.store.balance("owner")).toBe(17);
});

it("preserves previous audio and refunds speech when a later workflow produces invalid MP3", async () => {
	const first = await request();
	await service().start("owner", first);
	await execute(first.id);
	const previous = await db.store.outputs(projectId, [speechNode.id], "speech");
	speech.mockResolvedValueOnce({
		bytes: new Uint8Array([0, 1, 2]),
		mimeType: "audio/mpeg",
	});
	const next = await request();
	await service().start("owner", next);
	await execute(next.id);
	expect((await db.graphs.get(next.id))?.status).toBe("failed");
	expect(await db.store.outputs(projectId, [speechNode.id], "speech")).toEqual(
		previous,
	);
	expect(await db.store.balance("owner")).toBe(16);
});

it("rejects image, video and speech inputs to a speech node before spending", async () => {
	for (const kind of ["image", "video", "speech"] as const) {
		const source = createCanvasNode(kind, { x: 0, y: 0 });
		source.data.content = "Source";
		const invalid: CanvasDocument = {
			version: 1,
			nodes: [source, speechNode],
			edges: [connect(source.id, speechNode.id)],
		};
		await expect(planGraph(invalid, speechNode.id)).rejects.toThrow(
			"connected text scripts only",
		);
	}
	expect(await db.store.balance("owner")).toBe(20);
});
