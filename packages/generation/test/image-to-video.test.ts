import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaService } from "@kousa/media/service";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { defaultImageModel } from "../src/contracts";
import { createGenerationImageAccess } from "../src/image-access";
import { generationImageOrigin } from "../src/image-origin";
import {
	buildVideoPrompt,
	generationInputHash,
	videoInputSnapshot,
} from "../src/input";
import type { VideoProvider } from "../src/providers";
import { createGenerationRunner } from "../src/runner";
import { createGenerationService } from "../src/service";
import { executeGenerationWorkflow } from "../src/workflow";
import { inlineSteps, memoryArtifacts, unavailableImage } from "./helpers";

const png = new Uint8Array(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOLsAAAAASUVORK5CYII=",
		"base64",
	),
);
const video = new Uint8Array(
	readFileSync(new URL("../../media/test/fixtures/clip.mp4", import.meta.url)),
);
let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let source = createCanvasNode("image", { x: 0, y: 0 });
let target = createCanvasNode("video", { x: 400, y: 0 });
let graph: CanvasDocument;
let media: ReturnType<typeof createMediaService>;
let assetId: string;
let artifacts = memoryArtifacts();
const start = vi.fn<VideoProvider["start"]>();
const poll = vi.fn<VideoProvider["poll"]>();
const objects = new Map<string, Uint8Array<ArrayBuffer>>();
const access = () => createGenerationImageAccess(db.store, media);
const projects = () =>
	createProjectService(db.projects, {
		appUrl: "https://kousa.app",
		email: {
			isConfigured: () => false,
			send: async () => ({ messageId: null }),
		},
	});
const service = (origin = "https://kousa.app") =>
	createGenerationService(
		db.store,
		projects(),
		{
			textConfigured: false,
			imageConfigured: false,
			videoConfigured: true,
			imageInputOrigin: origin,
			dispatch: async () => {},
		},
		db.media,
	);
const runner = (issue = access().issue) =>
	createGenerationRunner(
		db.store,
		artifacts,
		{
			configured: false,
			generate: async () => {
				throw new Error("Unexpected text call");
			},
		},
		unavailableImage,
		media,
		undefined,
		{ configured: true, start, poll },
		issue,
	);
const request = async (inputImageAssetId = assetId) => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId: target.id,
	inputHash: await generationInputHash(graph, target.id),
	inputImageAssetId,
});
const http = (
	url: string,
	method = "GET",
	id = new URL(url).pathname.split("/").at(-1) ?? "",
) => access().handle(new Request(url, { method }), id);
async function startRun(actor = "owner") {
	const input = await request();
	await service().generate(actor, input);
	expect(await runner().generate(input.id)).toBe("pending");
	const url = start.mock.calls.at(-1)?.[0].imageUrl;
	if (!url) throw new Error("Expected scoped input URL");
	return { id: input.id, url, input };
}
async function generatedImage() {
	const id = crypto.randomUUID();
	await db.store.claim({
		id,
		projectId,
		nodeId: source.id,
		userId: "owner",
		kind: "image",
		modelId: defaultImageModel,
		prompt: "Image",
		inputHash: "a".repeat(64),
		credits: 3,
		size: "1024x1024",
	});
	await db.store.start(id);
	await db.store.finishMedia(id, assetId);
}
beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	await db.grant("owner", 50);
	await db.grant("editor", 50);
	objects.clear();
	artifacts = memoryArtifacts();
	start.mockReset().mockResolvedValue({ job: "image-video" });
	poll.mockReset().mockResolvedValue({
		status: "succeeded",
		bytes: video,
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
	assetId = (
		await media.upload("owner", projectId, {
			name: "input.png",
			bytes: png,
			mimeType: "image/png",
		})
	).id;
	source = createCanvasNode("image", { x: 0, y: 0 });
	source.data.assetId = assetId;
	source.data.imageSource = "project";
	target = createCanvasNode("video", { x: 400, y: 0 });
	target.data.content = "Slow camera pan";
	graph = {
		version: 1,
		nodes: [source, target],
		edges: [
			{
				id: crypto.randomUUID(),
				source: source.id,
				target: target.id,
				sourceHandle: "output",
				targetHandle: "image",
			},
		],
	};
	await db.setGraph(projectId, graph);
});

it("freezes the selected image and issues one scoped URL across durable retries", async () => {
	const { id, url, input } = await startRun("editor");
	expect(start).toHaveBeenCalledWith(
		expect.objectContaining({
			prompt: "Slow camera pan",
			duration: 5,
			imageUrl: url,
		}),
	);
	const stored = await db.store.get(id);
	expect(stored).toMatchObject({
		inputImageAssetId: assetId,
		inputImageOrigin: "https://kousa.app",
		inputImageTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
	});
	expect(stored?.inputImageTokenHash).not.toBe(
		new URL(url).searchParams.get("token"),
	);
	graph.edges = [];
	source.data.assetId = crypto.randomUUID();
	target.data.content = "Later edit";
	await db.setGraph(projectId, graph);
	const result = await service().generate("editor", input);
	expect(result.inputImageAssetId).toBe(assetId);
	expect(result).not.toHaveProperty("inputImageTokenHash");
	expect(result).not.toHaveProperty("inputImageOrigin");
	const response = await http(url);
	expect(response.status).toBe(200);
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
	poll.mockResolvedValueOnce({ status: "pending" });
	expect(await runner().generate(id)).toBe("pending");
	expect((await db.store.get(id))?.inputImageTokenHash).toBe(
		stored?.inputImageTokenHash,
	);
	await executeGenerationWorkflow(id, runner(), inlineSteps);
	expect(start).toHaveBeenCalledTimes(1);
	expect((await db.store.get(id))?.status).toBe("succeeded");
	expect(await db.store.balance("editor")).toBe(40);
	expect(await db.store.balance("owner")).toBe(50);
	expect((await http(url)).status).toBe(404);
	expect(
		(await service().list("viewer", { projectId })).videoResults[0]
			?.inputImageAssetId,
	).toBe(assetId);
});

it("serves only the authorized image with GET/HEAD and no cacheable or identifying headers", async () => {
	const { id, url } = await startRun();
	const head = await http(url, "HEAD");
	expect(head.status).toBe(200);
	expect(await head.text()).toBe("");
	expect(head.headers.get("content-length")).toBe(String(png.length));
	expect(head.headers.get("content-type")).toBe("image/png");
	expect(head.headers.get("cache-control")).toBe("private, no-store");
	expect(head.headers.get("referrer-policy")).toBe("no-referrer");
	expect(head.headers.get("content-disposition")).not.toContain("input.png");
	for (const invalid of [
		url.split("?")[0] ?? url,
		`${url.split("?")[0]}?token=${"0".repeat(64)}`,
		url.replace(id, crypto.randomUUID()),
		url.replace(id, assetId),
	])
		expect((await http(invalid)).status).toBe(404);
	expect((await http(url, "POST")).status).toBe(405);
	// Extra client query parameters never choose a different object.
	const response = await http(`${url}&assetId=${crypto.randomUUID()}`);
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
});

it.each(["expired", "failed", "revoked"])(
	"invalidates input access when the job is %s",
	async (state) => {
		const { id, url } = await startRun("editor");
		if (state === "expired") await db.expire(id);
		if (state === "failed") await db.store.finish(id, { error: "Failed" });
		if (state === "revoked") await db.revoke("editor");
		expect((await http(url)).status).toBe(404);
		await executeGenerationWorkflow(id, runner(), inlineSteps);
		expect(await db.store.balance("editor")).toBe(50);
	},
);

it("accepts image-only input and selects the latest generated image", async () => {
	await generatedImage();
	source.data.imageSource = "generated";
	source.data.assetId = null;
	target.data.content = "";
	await db.setGraph(projectId, graph);
	expect(buildVideoPrompt(videoInputSnapshot(graph, target.id), [])).toBe("");
	await startRun();
	expect(start.mock.calls[0]?.[0].prompt).toBe("");
});

it("rejects an image that changed since the user saw it before reserving credits", async () => {
	await generatedImage();
	source.data.imageSource = "generated";
	await db.setGraph(projectId, graph);
	await expect(
		service().generate("owner", await request(crypto.randomUUID())),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(await db.store.balance("owner")).toBe(47);
	expect(start).not.toHaveBeenCalled();
});

it.each([
	"",
	"http://localhost:3001",
	"https://127.0.0.1",
	"https://private.internal",
	"https://kousa.app/path",
])(
	"rejects a non-public app origin (%s) before reserving credits",
	async (origin) => {
		expect(
			(await service(origin).list("owner", { projectId }))
				.imageToVideoConfigured,
		).toBe(false);
		await expect(
			service(origin).generate("owner", await request()),
		).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
		expect(await db.store.balance("owner")).toBe(50);
		graph.edges = [];
		await db.setGraph(projectId, graph);
		const { inputImageAssetId: _image, ...input } = await request();
		expect((await service(origin).generate("owner", input)).status).toBe(
			"queued",
		);
	},
);

it("rejects missing images and unexpected request assets", async () => {
	source.data.assetId = null;
	await db.setGraph(projectId, graph);
	await expect(
		service().generate("owner", await request()),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	graph.edges = [];
	await db.setGraph(projectId, graph);
	await expect(
		service().generate("owner", await request()),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(await db.store.balance("owner")).toBe(50);
});

it("rejects missing, staged, and non-image assets before charging", async () => {
	const audio = await media.stageSpeech("owner", projectId, {
		name: "voice.mp3",
		bytes: new Uint8Array(
			readFileSync(
				new URL("../../media/test/fixtures/tone.mp3", import.meta.url),
			),
		),
		mimeType: "audio/mpeg",
	});
	await db.media.complete("owner", audio.id);
	const staged = await db.media.reserve({
		projectId,
		uploaderId: "owner",
		name: "pending.png",
		mimeType: "image/png",
		sha256: "b".repeat(64),
		bytes: 100,
		width: 1,
		height: 1,
		durationMs: null,
	});
	if (typeof staged === "string") throw new Error("Fixture failed");
	for (const id of [crypto.randomUUID(), audio.id, staged.id]) {
		source.data.assetId = id;
		await db.setGraph(projectId, graph);
		await expect(
			service().generate("owner", await request(id)),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	}
	expect(await db.store.balance("owner")).toBe(50);
});

it("fails safely without submitting when the token cannot be saved or the private file is absent", async () => {
	let input = await request();
	await service().generate("owner", input);
	const failedAccess = createGenerationImageAccess(
		{ ...db.store, setInputImageToken: async () => false },
		media,
	);
	expect(await runner(failedAccess.issue).generate(input.id)).toBe(false);
	expect(await db.store.balance("owner")).toBe(50);
	input = await request();
	await service().generate("owner", input);
	objects.clear();
	expect(await runner().generate(input.id)).toBe(false);
	expect(start).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(50);
});

it("requires editor access at submission and again before issuing a URL", async () => {
	await expect(
		service().generate("viewer", await request()),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	await expect(
		service().generate("outsider", await request()),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	const input = await request();
	await service().generate("editor", input);
	await db.revoke("editor");
	expect(await runner().generate(input.id)).toBe(false);
	expect(start).not.toHaveBeenCalled();
	expect(await db.store.balance("editor")).toBe(50);
});

it("rejects another project's image in both the service and the atomic reservation", async () => {
	const other = await db.projects.create("owner", "Other project");
	const foreign = await media.upload("owner", other.id, {
		name: "other.png",
		mimeType: "image/png",
		bytes: png,
	});
	source.data.assetId = foreign.id;
	await db.setGraph(projectId, graph);
	const input = await request(foreign.id);
	await expect(service().generate("owner", input)).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
	expect(
		await db.store.claim({
			...input,
			userId: "owner",
			kind: "video",
			modelId: target.data.videoModel ?? "bytedance/seedance-v1.0-pro-fast",
			prompt: "Motion",
			credits: 10,
			duration: 5,
			aspectRatio: "16:9",
			inputImageOrigin: "https://kousa.app",
		}),
	).toEqual({ claimed: false, error: "CONFLICT" });
	expect(await db.store.get(input.id)).toBeNull();
	expect(await db.store.balance("owner")).toBe(50);
});

it("hashes the selected source and rejects more than one image", async () => {
	const initial = await generationInputHash(graph, target.id);
	source.data.imageSource = "generated";
	expect(await generationInputHash(graph, target.id)).not.toBe(initial);
	const second = createCanvasNode("image", { x: 0, y: 200 });
	graph.nodes.push(second);
	graph.edges.push({
		id: crypto.randomUUID(),
		source: second.id,
		target: target.id,
		sourceHandle: "output",
		targetHandle: "image",
	});
	expect(() => videoInputSnapshot(graph, target.id)).toThrow("only one image");
});

it("normalizes public HTTPS origins without permitting credentials or URL components", () => {
	expect(generationImageOrigin("https://Kousa.app:443/")).toBe(
		"https://kousa.app",
	);
	for (const origin of [
		"https://user:pass@kousa.app",
		"https://kousa.app?x=1",
		"https://kousa.app#x",
		"https://[::1]",
		"https://kousa.app:444",
		"https://kousa.test",
	])
		expect(generationImageOrigin(origin)).toBeNull();
});
