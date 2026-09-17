import { createMediaTestDatabase } from "@kousa/db/testing-media";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { maxImageBytes } from "../src/contracts";
import { createMediaHandler } from "../src/http";
import { createMediaService } from "../src/service";
import type { MediaStorage } from "../src/storage";

const png = () =>
	new Uint8Array(
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOLsAAAAASUVORK5CYII=",
			"base64",
		),
	);
const file = () => ({ bytes: png(), mimeType: "image/png", name: "image.png" });
describe("private project images", () => {
	let db: Awaited<ReturnType<typeof createMediaTestDatabase>>;
	let service: ReturnType<typeof createMediaService>;
	let projectId: string;
	let otherProjectId: string;
	let storage: MediaStorage;
	const objects = new Map<string, Uint8Array<ArrayBuffer>>();
	beforeAll(async () => {
		db = await createMediaTestDatabase();
	}, 30_000);
	afterAll(async () => {
		await db.close();
	});
	beforeEach(async () => {
		({ projectId, otherProjectId } = await db.reset());
		objects.clear();
		storage = {
			put: vi.fn(async (key, bytes) => {
				objects.set(key, bytes);
			}),
			get: vi.fn(async (key) => {
				const bytes = objects.get(key);
				return bytes
					? {
							body: new Response(bytes).body as ReadableStream,
							bytes: bytes.length,
						}
					: null;
			}),
		};
		service = createMediaService(db.store, db.projects, storage);
	});
	function request(
		actor: string | null,
		method = "GET",
		assetId?: string,
		options: RequestInit = {},
	) {
		const handler = createMediaHandler({
			actor: async () => actor,
			service: () => service,
		});
		return handler(
			new Request(`https://kousa.app/api/projects/${projectId}/media`, {
				method,
				...options,
			}),
			{ projectId, assetId },
		);
	}
	it("persists an editor upload and lets viewers read exact bytes without exposing keys", async () => {
		const asset = await service.upload("editor", projectId, file());
		expect(asset).toMatchObject({ width: 1, height: 1, mimeType: "image/png" });
		expect(await service.list("viewer", projectId)).toEqual([asset]);
		expect(asset).not.toHaveProperty("sha256");
		const response = await request("viewer", "GET", asset.id);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(png());
	});
	it("denies viewer writes, outsiders, signed-out requests, and cross-project reads", async () => {
		const asset = await service.upload("owner", projectId, file());
		await expect(
			service.upload("viewer", projectId, file()),
		).rejects.toMatchObject({ status: 403 });
		expect((await request("outsider", "GET", asset.id)).status).toBe(404);
		expect((await request(null, "GET", asset.id)).status).toBe(401);
		await expect(
			service.read("outsider", otherProjectId, asset.id),
		).rejects.toMatchObject({ status: 404 });
		await db.revoke("viewer");
		expect((await request("viewer", "GET", asset.id)).status).toBe(404);
	});
	it("deduplicates retries and concurrent identical uploads within a project", async () => {
		const [first, second] = await Promise.all([
			service.upload("owner", projectId, file()),
			service.upload("editor", projectId, file()),
		]);
		expect(second.id).toBe(first.id);
		expect(await db.rows()).toHaveLength(1);
		const other = await service.upload("outsider", otherProjectId, file());
		expect(other.id).not.toBe(first.id);
	});
	it("keeps failed writes invisible and resumes when the same file is retried", async () => {
		vi.mocked(storage.put).mockRejectedValueOnce(new Error("Storage offline"));
		await expect(service.upload("editor", projectId, file())).rejects.toThrow(
			"Storage offline",
		);
		expect(await service.list("viewer", projectId)).toEqual([]);
		expect(await db.rows()).toMatchObject([{ status: "pending" }]);
		await service.upload("editor", projectId, file());
		expect(await db.rows()).toMatchObject([{ status: "ready" }]);
	});
	it("does not publish a new image when editor access is revoked during storage", async () => {
		vi.mocked(storage.put).mockImplementationOnce(async () => {
			await db.revoke("editor");
		});
		await expect(
			service.upload("editor", projectId, file()),
		).rejects.toMatchObject({ status: 403 });
		expect(await service.list("owner", projectId)).toEqual([]);
		await expect(
			db.store.reserve({
				projectId,
				uploaderId: "editor",
				sha256: "0".repeat(64),
				name: "x",
				mimeType: "image/png",
				bytes: 1,
				width: 1,
				height: 1,
			}),
		).resolves.toBe("forbidden");
	});
	it("recovers when completion committed but its response was lost", async () => {
		const original = db.store.complete;
		const complete = vi.spyOn(db.store, "complete");
		complete.mockImplementationOnce(async (...args) => {
			await original(...args);
			throw new Error("Lost response");
		});
		await expect(service.upload("owner", projectId, file())).rejects.toThrow(
			"Lost response",
		);
		const asset = await service.upload("owner", projectId, file());
		expect(
			(await service.read("viewer", projectId, asset.id)).object.bytes,
		).toBe(png().length);
		expect(await db.rows()).toHaveLength(1);
		complete.mockRestore();
	});
	it("rejects spoofed types, SVG, invalid headers, empty and oversized files", async () => {
		for (const invalid of [
			{ ...file(), mimeType: "image/jpeg" },
			{
				...file(),
				bytes: new TextEncoder().encode(
					'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>',
				),
				mimeType: "image/svg+xml",
			},
			{ ...file(), bytes: new TextEncoder().encode("not an image") },
		])
			await expect(
				service.upload("owner", projectId, invalid),
			).rejects.toMatchObject({ status: 415 });
		for (const bytes of [new Uint8Array(0), new Uint8Array(maxImageBytes + 1)])
			await expect(
				service.upload("owner", projectId, { ...file(), bytes }),
			).rejects.toMatchObject({ status: 413 });
		expect(storage.put).not.toHaveBeenCalled();
	});
	it("enforces a serialized project quota including pending uploads", async () => {
		const input = {
			projectId,
			uploaderId: "owner",
			name: "x.png",
			mimeType: "image/png",
			bytes: maxImageBytes,
			width: 1,
			height: 1,
		};
		const results = await Promise.all(
			Array.from({ length: 11 }, (_, i) =>
				db.store.reserve({
					...input,
					sha256: i.toString(16).padStart(64, "0"),
				}),
			),
		);
		expect(results.filter((result) => result === "full")).toHaveLength(1);
		expect(await db.rows()).toHaveLength(10);
	});
	it("requires same-origin uploads and rejects a streaming body over the limit", async () => {
		expect(
			(
				await request("owner", "POST", undefined, {
					headers: { origin: "https://other.test" },
				})
			).status,
		).toBe(403);
		const response = await request("owner", "POST", undefined, {
			headers: { origin: "https://kousa.app", "content-type": "image/png" },
			body: new Uint8Array(maxImageBytes + 1),
		});
		expect(response.status).toBe(413);
		expect(storage.put).not.toHaveBeenCalled();
	});
	it("truncates long Unicode names without breaking file responses", async () => {
		const asset = await service.upload("owner", projectId, {
			...file(),
			name: `${"x".repeat(179)}🌊.png`,
		});
		const response = await request("viewer", "GET", asset.id);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-disposition")).toContain(
			"%F0%9F%8C%8A",
		);
	});
	it("rejects oversized dimensions before creating an asset", async () => {
		const bytes = png();
		new DataView(bytes.buffer).setUint32(16, 40_000_001);
		await expect(
			service.upload("owner", projectId, { ...file(), bytes }),
		).rejects.toMatchObject({ status: 413 });
		expect(await db.rows()).toHaveLength(0);
	});
	it("accepts uploads over HTTP and sanitizes filenames", async () => {
		const response = await request("owner", "POST", undefined, {
			headers: {
				origin: "https://kousa.app",
				"content-type": "image/png",
				"x-file-name": encodeURIComponent("../test\n.png"),
			},
			body: png(),
		});
		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({
			asset: { name: "..test.png" },
		});
	});
});
