import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaHandler } from "@kousa/media/http";
import { createMediaService, objectKey } from "@kousa/media/service";
import type { MediaStorage } from "@kousa/media/storage";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
	defaultImageModel,
	defaultSpeechModel,
	defaultSpeechVoice,
	defaultTextModel,
	defaultVideoModel,
} from "../src/contracts";
import { graphFreshness } from "../src/freshness";
import { generationInputHash } from "../src/input";
import { createPlaygroundService } from "../src/playground-service";
import { createGenerationRunner } from "../src/runner";
import { executeGenerationWorkflow } from "../src/workflow";
import { inlineSteps, memoryArtifacts } from "./helpers";

let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
const dispatch = vi.fn<(id: string) => Promise<void>>();
const text = vi.fn(async () => ({
	output: "A saved answer",
	inputTokens: 2,
	outputTokens: 3,
}));
const image = vi.fn(async () => ({
	bytes: new Uint8Array(
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=",
			"base64",
		),
	),
	mimeType: "image/png",
}));
let objects = new Map<string, Uint8Array<ArrayBuffer>>();
const storage: MediaStorage = {
	async put(key, bytes) {
		objects.set(key, bytes);
	},
	async get(key, range) {
		const bytes = objects.get(key);
		if (!bytes) return null;
		const result = range
			? bytes.slice(range.offset, range.offset + range.length)
			: bytes;
		return { bytes: result.length, body: new Blob([result]).stream() };
	},
};
const projects = () =>
	createProjectService(db.projects, {
		appUrl: "https://example.test",
		email: {
			isConfigured: () => false,
			send: async () => ({ messageId: null }),
		},
	});
const media = () => createMediaService(db.media, db.projects, storage);
const service = () =>
	createPlaygroundService(
		db.store,
		projects(),
		{
			textConfigured: true,
			imageConfigured: true,
			speechConfigured: true,
			videoConfigured: true,
			dispatch,
		},
		media(),
	);
const request = () => ({
	id: crypto.randomUUID(),
	settings: {
		kind: "text" as const,
		modelId: defaultTextModel,
		content: "Write a greeting.",
	},
});
const finish = (id: string) =>
	executeGenerationWorkflow(
		id,
		createGenerationRunner(
			db.store,
			memoryArtifacts(),
			{ configured: true, generate: text },
			{ configured: true, generate: image },
			media(),
		),
		inlineSteps,
	);

beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	await db.grant("owner", 100);
	objects = new Map();
	dispatch.mockReset().mockResolvedValue();
	text.mockClear();
	image.mockClear();
});

it("queues without creating a project or canvas, and keeps history private", async () => {
	const before = await projects().list("owner");
	const input = request();
	expect(await service().generate("owner", input)).toMatchObject({
		status: "queued",
		prompt: input.settings.content,
	});
	expect(await db.store.get(input.id)).toMatchObject({
		projectId: null,
		canvasId: null,
		userId: "owner",
	});
	expect(await projects().list("owner")).toEqual(before);
	expect((await service().history("outsider")).runs).toEqual([]);
	expect((await service().history("owner")).runs).toHaveLength(1);
	expect(await db.store.latest(projectId)).toEqual([]);
	expect(await db.store.balance("owner")).toBe(99);
	await finish(input.id);
	expect(await db.store.get(input.id)).toMatchObject({
		status: "succeeded",
		output: "A saved answer",
	});
	expect(await db.store.balance("owner")).toBe(99);
});
it("retries the same request without a second charge or provider call", async () => {
	const input = request();
	await service().generate("owner", input);
	await service().generate("owner", input);
	await finish(input.id);
	await service().generate("owner", input);
	await finish(input.id);
	expect(text).toHaveBeenCalledTimes(1);
	expect(await db.store.balance("owner")).toBe(99);
	await expect(service().generate("outsider", input)).rejects.toMatchObject({
		code: "CONFLICT",
	});
	await expect(
		service().generate("owner", {
			...input,
			settings: { ...input.settings, content: "Changed" },
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
});
it("recovers dispatch failure through the existing outbox", async () => {
	dispatch.mockRejectedValue(new Error("offline"));
	const input = request();
	expect((await service().generate("owner", input)).status).toBe("queued");
	expect(await db.store.pending()).toEqual([{ id: input.id }]);
	await finish(input.id);
	expect((await service().history("owner")).runs[0]?.status).toBe("succeeded");
});
it("enforces available credits and the shared per-user concurrency limit", async () => {
	await expect(service().generate("outsider", request())).rejects.toMatchObject(
		{ code: "PAYMENT_REQUIRED" },
	);
	const input = request();
	await service().generate("owner", input);
	await expect(service().generate("owner", request())).rejects.toMatchObject({
		code: "CONFLICT",
	});
	expect((await service().history("owner")).busy).toBe(true);
	const claim = await db.store.claim({
		id: crypto.randomUUID(),
		userId: "owner",
		projectId,
		nodeId: crypto.randomUUID(),
		modelId: defaultTextModel,
		prompt: "Canvas",
		inputHash: "a".repeat(64),
		credits: 1,
	});
	expect(claim.error).toBe("BUSY");
	await db.store.finish(input.id, { error: "Provider unavailable" });
	expect(await db.store.balance("owner")).toBe(100);
	expect((await service().history("owner")).busy).toBe(false);
});
it("validates prompts and model capabilities before reserving credits", async () => {
	for (const settings of [
		{ ...request().settings, content: " " },
		{ ...request().settings, modelId: defaultImageModel },
		{
			kind: "speech",
			modelId: defaultSpeechModel,
			content: "a".repeat(1001),
			voiceId: defaultSpeechVoice,
			voiceDirection: "",
		},
		{
			kind: "video",
			modelId: defaultVideoModel,
			content: "Birds",
			duration: 20,
			aspectRatio: "1:1",
		},
	])
		await expect(
			service().generate("owner", { id: crypto.randomUUID(), settings }),
		).rejects.toThrow();
	expect(await db.store.balance("owner")).toBe(100);
	expect(dispatch).not.toHaveBeenCalled();
});
it("saves personal images and prevents access through another account or a project", async () => {
	const input = {
		id: crypto.randomUUID(),
		settings: {
			kind: "image" as const,
			modelId: defaultImageModel,
			content: "A red dot",
			aspectRatio: "1:1" as const,
		},
	};
	await service().generate("owner", input);
	await finish(input.id);
	const run = await db.store.get(input.id);
	expect(run?.status).toBe("succeeded");
	const assetId = run?.assetId ?? "";
	const asset = await db.media.getPersonal("owner", assetId);
	expect(asset).toMatchObject({
		ownerId: "owner",
		projectId: null,
		status: "ready",
	});
	if (!asset) throw new Error("Missing personal image");
	expect(objects.has(objectKey(asset))).toBe(true);
	await expect(media().read("outsider", null, assetId)).rejects.toMatchObject({
		status: 404,
	});
	await expect(media().read("owner", projectId, assetId)).rejects.toMatchObject(
		{ status: 404 },
	);
	const response = await createMediaHandler({
		actor: async () => "owner",
		service: media,
		personal: true,
	})(
		new Request(`https://example.test/api/playground/media/${assetId}`, {
			headers: { Range: "bytes=0-7" },
		}),
		{ assetId },
	);
	expect(response.status).toBe(206);
	expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	expect((await response.arrayBuffer()).byteLength).toBe(8);
});
it("imports text with its original settings and output at zero credits, idempotently", async () => {
	const input = request();
	await service().generate("owner", input);
	await finish(input.id);
	const destination = { runId: input.id, projectId, canvasId: projectId };
	const first = await service().importToCanvas("owner", destination);
	const second = await service().importToCanvas("owner", destination);
	expect(first).toEqual(second);
	expect(first.node.data).toMatchObject({
		content: input.settings.content,
		textModel: defaultTextModel,
		selectedRunId: first.node.id,
	});
	const copy = await db.store.get(first.node.id);
	expect(copy).toMatchObject({
		projectId,
		canvasId: projectId,
		sourceRunId: input.id,
		credits: 0,
		status: "succeeded",
		output: "A saved answer",
	});
	expect(copy?.inputHash).toBe(
		await generationInputHash(
			{ version: 1, nodes: [first.node], edges: [] },
			first.node.id,
		),
	);
	if (!copy) throw new Error("Missing import");
	expect(
		graphFreshness({ version: 1, nodes: [first.node], edges: [] }, [copy]).get(
			first.node.id,
		)?.state,
	).toBe("current");
	expect(await db.store.balance("owner")).toBe(99);
	expect(text).toHaveBeenCalledTimes(1);
	expect((await service().history("owner")).runs).toHaveLength(1);
});
it("copies image bytes into project storage without exposing personal media", async () => {
	const input = {
		id: crypto.randomUUID(),
		settings: {
			kind: "image" as const,
			modelId: defaultImageModel,
			content: "A red dot",
			aspectRatio: "1:1" as const,
		},
	};
	await service().generate("owner", input);
	await finish(input.id);
	const source = await db.store.get(input.id);
	const imported = await service().importToCanvas("owner", {
		runId: input.id,
		projectId,
		canvasId: projectId,
	});
	const copy = await db.store.get(imported.node.id);
	expect(copy?.assetId).not.toBe(source?.assetId);
	expect(await db.media.get(projectId, copy?.assetId ?? "")).toMatchObject({
		projectId,
		ownerId: null,
		status: "ready",
	});
	expect(
		(await media().read("viewer", projectId, copy?.assetId ?? "")).asset.id,
	).toBe(copy?.assetId);
	expect(await db.store.balance("owner")).toBe(97);
	expect(image).toHaveBeenCalledTimes(1);
});
it("rejects cross-user imports, unavailable canvases, and revoked editing access", async () => {
	const input = request();
	await service().generate("owner", input);
	await finish(input.id);
	await expect(
		service().importToCanvas("viewer", {
			runId: input.id,
			projectId,
			canvasId: projectId,
		}),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	await expect(
		service().importToCanvas("owner", {
			runId: input.id,
			projectId,
			canvasId: crypto.randomUUID(),
		}),
	).rejects.toThrow();
	const other = await projects().create("outsider", { name: "Private" });
	await expect(
		service().importToCanvas("owner", {
			runId: input.id,
			projectId: other.id,
			canvasId: other.id,
		}),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("pages personal history without leaking another user's runs", async () => {
	for (let i = 0; i < 3; i++) {
		const input = request();
		await service().generate("owner", input);
		await finish(input.id);
	}
	const first = await service().history("owner", { limit: 2 });
	const second = await service().history("owner", {
		limit: 2,
		cursor: first.nextCursor,
	});
	expect(first.runs).toHaveLength(2);
	expect(second.runs).toHaveLength(1);
	expect(new Set([...first.runs, ...second.runs].map((r) => r.id)).size).toBe(
		3,
	);
});
it("does not allow a personal run ID to be claimed by a project", async () => {
	const input = request();
	await service().generate("owner", input);
	const claim = await db.store.claim({
		id: input.id,
		userId: "owner",
		projectId,
		nodeId: input.id,
		modelId: defaultTextModel,
		prompt: "Canvas",
		inputHash: "a".repeat(64),
		credits: 1,
	});
	expect(claim.error).toBe("CONFLICT");
});

it("releases expired personal reservations when history is opened", async () => {
	const input = request();
	await service().generate("owner", input);
	await db.expire(input.id);
	const history = await service().history("owner");
	expect(history.runs[0]?.status).toBe("failed");
	expect(history.balance).toBe(100);
	expect(history.busy).toBe(false);
});

it("imports into a selected secondary canvas without touching the first", async () => {
	const input = request();
	await service().generate("owner", input);
	await finish(input.id);
	const canvas = await projects().createCanvas("owner", {
		projectId,
		name: "Second canvas",
	});
	const { node } = await service().importToCanvas("owner", {
		runId: input.id,
		projectId,
		canvasId: canvas.id,
	});
	expect(await db.store.latest(projectId)).toEqual([]);
	expect(await db.store.latest(projectId, [node.id], canvas.id)).toHaveLength(
		1,
	);
});

it("rejects a viewer importing their own generation into a shared project", async () => {
	await db.grant("viewer", 1);
	const input = request();
	await service().generate("viewer", input);
	await finish(input.id);
	await expect(
		service().importToCanvas("viewer", {
			runId: input.id,
			projectId,
			canvasId: projectId,
		}),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("requires authentication for personal downloads and rejects guessed asset IDs", async () => {
	const assetId = crypto.randomUUID();
	const handler = (actor: string | null) =>
		createMediaHandler({
			personal: true,
			actor: async () => actor,
			service: media,
		});
	const url = `https://example.test/api/playground/media/${assetId}`;
	expect((await handler(null)(new Request(url), { assetId })).status).toBe(401);
	expect(
		(await handler("outsider")(new Request(url), { assetId })).status,
	).toBe(404);
	expect(
		(await handler("owner")(new Request(url, { method: "POST" }), { assetId }))
			.status,
	).toBe(405);
});

it.each([
	{ kind: "text", content: "Hello", modelId: defaultTextModel },
	{
		kind: "image",
		content: "Hello",
		modelId: defaultImageModel,
		aspectRatio: "9:16",
	},
	{
		kind: "video",
		content: "Hello",
		modelId: defaultVideoModel,
		aspectRatio: "16:9",
		duration: 10,
	},
	{
		kind: "speech",
		content: "Hello",
		modelId: defaultSpeechModel,
		voiceId: defaultSpeechVoice,
		voiceDirection: "Calm",
	},
])("captures reusable input history for $kind", async (settings) => {
	const id = crypto.randomUUID();
	await service().generate("owner", { id, settings });
	const run = await db.store.get(id);
	expect(run?.resolvedInputs).toMatchObject({
		version: 1,
		settings: {
			kind: settings.kind,
			modelId: settings.modelId,
			content: settings.content,
		},
		text: [],
		image: null,
	});
	expect(run?.credits).toBe(
		settings.kind === "video"
			? 20
			: settings.kind === "image"
				? 3
				: settings.kind === "speech"
					? 2
					: 1,
	);
});
