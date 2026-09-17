import { createGenerationTestDatabase } from "@kousa/db/testing-generation";
import { createMediaService } from "@kousa/media/service";
import type { MediaStorage } from "@kousa/media/storage";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { createProjectService } from "@kousa/projects/service";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
	defaultImageModel,
	imageCreditCost,
	imageSizes,
} from "../src/contracts";
import {
	buildImagePrompt,
	generationInputHash,
	imageInputSnapshot,
} from "../src/input";
import type { ImageProvider } from "../src/service";
import { inlineService } from "./helpers";

let db: Awaited<ReturnType<typeof createGenerationTestDatabase>>;
let projectId: string;
let graph: CanvasDocument;
let target = createCanvasNode("image", { x: 0, y: 0 });
const png = new Uint8Array(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOLsAAAAASUVORK5CYII=",
		"base64",
	),
);
const response = { bytes: png, mimeType: "image/png" };
const generate = vi.fn<ImageProvider["generate"]>();
const textGenerate = vi.fn();
const put = vi.fn<MediaStorage["put"]>();
const objects = new Map<string, Uint8Array<ArrayBuffer>>();
let media: ReturnType<typeof createMediaService>;
const projects = () =>
	createProjectService(db.projects, {
		appUrl: "https://example.test",
		email: {
			isConfigured: () => false,
			send: async () => ({ messageId: null }),
		},
	});
const service = (store = db.store) =>
	inlineService(
		store,
		projects(),
		{ configured: true, generate: textGenerate },
		{ configured: true, generate },
		media,
	);
const request = async (nodeId = target.id) => ({
	projectId,
	id: crypto.randomUUID(),
	nodeId,
	inputHash: await generationInputHash(graph, nodeId),
});
const reservation = () => ({
	id: crypto.randomUUID(),
	projectId,
	nodeId: target.id,
	userId: "owner",
	modelId: defaultImageModel,
	kind: "image" as const,
	prompt: "Test",
	inputHash: "a".repeat(64),
	credits: imageCreditCost,
});

beforeAll(async () => {
	db = await createGenerationTestDatabase();
}, 30_000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	projectId = await db.reset();
	target = createCanvasNode("image", { x: 0, y: 0 });
	target.data.content = "A quiet Kyoto street at blue hour";
	graph = { version: 1, nodes: [target], edges: [] };
	await db.setGraph(projectId, graph);
	await db.grant("owner", 10);
	objects.clear();
	generate.mockReset().mockResolvedValue(response);
	textGenerate.mockReset().mockResolvedValue({
		output: "A warm lantern in a rainy street",
		inputTokens: 10,
		outputTokens: 8,
	});
	put.mockReset().mockImplementation(async (key, bytes) => {
		objects.set(key, bytes);
	});
	media = createMediaService(db.media, db.projects, {
		put,
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

it.each(Object.entries(imageSizes))(
	"generates ratio %s at bounded size %s, then publishes and charges once",
	async (ratio, size) => {
		target.data.aspectRatio = ratio as keyof typeof imageSizes;
		await db.setGraph(projectId, graph);
		const input = await request();
		const run = await service().generate("owner", input);
		expect(run).toMatchObject({
			status: "succeeded",
			kind: "image",
			output: null,
			credits: 3,
			assetId: expect.any(String),
		});
		expect(generate).toHaveBeenCalledWith({
			modelId: defaultImageModel,
			size,
			prompt: target.data.content,
		});
		expect(await db.store.balance("owner")).toBe(7);
		expect(await service().generate("owner", input)).toEqual(run);
		expect(generate).toHaveBeenCalledTimes(1);
		const viewer = await service().list("viewer", { projectId });
		expect(viewer.imageResults).toEqual([run]);
		const asset = (await media.list("viewer", projectId))[0];
		expect(asset?.id).toBe(run.assetId);
		if (!asset) throw new Error("Missing generated asset");
		const read = await media.read("viewer", projectId, asset.id);
		expect(
			new Uint8Array(await new Response(read.object.body).arrayBuffer()),
		).toEqual(png);
		await expect(
			media.read("outsider", projectId, asset.id),
		).rejects.toMatchObject({ status: 404 });
	},
);
it("uses the connected text's successful output even with an empty image prompt", async () => {
	const source = createCanvasNode("text", { x: 0, y: 0 });
	source.data.content = "Write a prompt";
	target.data.content = "";
	graph.nodes.push(source);
	graph.edges.push({
		id: crypto.randomUUID(),
		source: source.id,
		target: target.id,
		sourceHandle: "output",
		targetHandle: "prompt",
	});
	await db.setGraph(projectId, graph);
	await service().generate("owner", await request(source.id));
	await service().generate("owner", await request());
	expect(generate.mock.calls[0]?.[0].prompt).toBe(
		"A warm lantern in a rainy street",
	);
	expect(await db.store.balance("owner")).toBe(6);
});
it("denies viewers, outsiders and unfunded editors before any provider call", async () => {
	for (const actor of ["viewer", "outsider", "editor"])
		await expect(service().generate(actor, await request())).rejects.toThrow();
	expect(generate).not.toHaveBeenCalled();
	await db.grant("editor", 3);
	await service().generate("editor", await request());
	expect(await db.store.balance("owner")).toBe(10);
	expect(await db.store.balance("editor")).toBe(0);
});
it.each(["provider", "storage", "invalid image"])(
	"releases credits after %s failure, without publishing or repeating the request",
	async (failure) => {
		if (failure === "provider")
			generate.mockRejectedValue(new Error("secret provider URL"));
		if (failure === "storage")
			put.mockRejectedValue(new Error("secret storage detail"));
		if (failure === "invalid image")
			generate.mockResolvedValue({
				bytes: new Uint8Array(new TextEncoder().encode("not an image")),
				mimeType: "image/png",
			});
		const input = await request();
		const run = await service().generate("owner", input);
		expect(run.status).toBe("failed");
		expect(run.error).not.toContain("secret");
		expect(await db.store.balance("owner")).toBe(10);
		expect(await media.list("viewer", projectId)).toEqual([]);
		await service().generate("owner", input);
		expect(generate).toHaveBeenCalledTimes(1);
	},
);
it("keeps the last successful image after a later failed retry", async () => {
	const first = await service().generate("owner", await request());
	generate.mockRejectedValue(new Error("failed"));
	await service().generate("owner", await request());
	const listed = await service().list("viewer", { projectId });
	expect(listed.runs[0]?.status).toBe("failed");
	expect(listed.imageResults[0]?.assetId).toBe(first.assetId);
	expect(await db.store.balance("owner")).toBe(7);
});
it("does not refund or regenerate if the final commit succeeds but its response is lost", async () => {
	const input = await request();
	const store = {
		...db.store,
		finishImage: vi.fn(async (id: string, assetId: string) => {
			await db.store.finishImage(id, assetId);
			throw new Error("Connection lost after commit");
		}),
	};
	await expect(service(store).generate("owner", input)).resolves.toMatchObject({
		status: "succeeded",
	});
	expect((await service().generate("owner", input)).status).toBe("succeeded");
	expect(generate).toHaveBeenCalledTimes(1);
	expect(await db.store.balance("owner")).toBe(7);
});
it("keeps staged files private and releases the reservation when the lease expires", async () => {
	const input = await request();
	put.mockImplementation(async (key, bytes) => {
		objects.set(key, bytes);
		expect(await media.list("viewer", projectId)).toEqual([]);
		expect(await db.store.balance("owner")).toBe(7);
		await db.expire(input.id);
	});
	expect((await service().generate("owner", input)).status).toBe("failed");
	expect(await media.list("viewer", projectId)).toEqual([]);
	expect(await db.store.balance("owner")).toBe(10);
});
it("rechecks editor access after storage finishes, before publishing and charging", async () => {
	await db.grant("editor", 3);
	put.mockImplementation(async (key, bytes) => {
		objects.set(key, bytes);
		await db.revoke("editor");
	});
	const run = await service().generate("editor", await request());
	expect(run.status).toBe("failed");
	expect(run.error).toContain("access changed");
	expect(await db.store.balance("editor")).toBe(3);
	expect(await media.list("viewer", projectId)).toEqual([]);
});
it("blocks unapproved models and stale dimensions before reserving", async () => {
	const stale = await request();
	target.data.aspectRatio = "16:9";
	await db.setGraph(projectId, graph);
	await expect(service().generate("owner", stale)).rejects.toMatchObject({
		code: "CONFLICT",
	});
	target.data.imageModel = "expensive/unapproved";
	await db.setGraph(projectId, graph);
	await expect(
		service().generate("owner", await request()),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(generate).not.toHaveBeenCalled();
	expect(await db.store.balance("owner")).toBe(10);
});
it("rejects reference connections and bounds combined prompt bytes", () => {
	expect(() =>
		buildImagePrompt(
			{ ...imageInputSnapshot(graph, target.id), content: "😀".repeat(3001) },
			[],
		),
	).toThrow("12 KB");
	expect(() =>
		buildImagePrompt(
			{ ...imageInputSnapshot(graph, target.id), content: " " },
			[],
		),
	).toThrow("Write a prompt");
	const source = createCanvasNode("image", { x: 0, y: 0 });
	graph.nodes.push(source);
	graph.edges.push({
		id: crypto.randomUUID(),
		source: source.id,
		target: target.id,
		sourceHandle: "output",
		targetHandle: "reference",
	});
	expect(() => imageInputSnapshot(graph, target.id)).toThrow(
		"Disconnect reference images",
	);
});
it("refuses a cross-project asset without publishing it or completing the debit", async () => {
	const otherProject = await db.projects.create("owner", "Other");
	const asset = await media.stage("owner", otherProject.id, {
		...response,
		name: "private.png",
	});
	const claimed = reservation();
	await db.store.claim(claimed);
	await db.store.start(claimed.id);
	await expect(db.store.finishImage(claimed.id, asset.id)).rejects.toThrow();
	expect(await media.list("owner", otherProject.id)).toEqual([]);
	expect((await db.store.get(claimed.id))?.status).toBe("running");
});
it("cannot reserve multiple image generations concurrently or overspend", async () => {
	const claims = await Promise.all(
		Array.from({ length: 6 }, () =>
			db.store.claim({ ...reservation(), nodeId: crypto.randomUUID() }),
		),
	);
	expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
	expect(await db.store.balance("owner")).toBe(7);
});
