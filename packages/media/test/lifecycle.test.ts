import { createMediaTestDatabase } from "@kousa/db/testing-media";
import { type CanvasDocument, createCanvasNode } from "@kousa/projects/canvas";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createMediaHandler } from "../src/http";
import { createMediaLifecycle } from "../src/lifecycle";
import { createMediaService } from "../src/service";
import type { MediaStorage } from "../src/storage";

let db: Awaited<ReturnType<typeof createMediaTestDatabase>>;
let projectId: string;
let otherProjectId: string;
let media: ReturnType<typeof createMediaService>;
let lifecycle: ReturnType<typeof createMediaLifecycle>;
let storage: MediaStorage & { delete: (key: string) => Promise<void> };
let document: CanvasDocument;
const readRoom = vi.fn(async () => document);
const png = () =>
	new Uint8Array(
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOLsAAAAASUVORK5CYII=",
			"base64",
		),
	);
const upload = (libraryOnly = true) =>
	media.upload(
		"owner",
		projectId,
		{ bytes: png(), mimeType: "image/png", name: "test.png" },
		libraryOnly,
	);
beforeAll(async () => {
	db = await createMediaTestDatabase();
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
	await db.query("delete from clip_run");
	await db.query("delete from generation_run");
	await db.query("delete from graph_run");
	({ projectId, otherProjectId } = await db.reset());
	document = { version: 1, nodes: [], edges: [] };
	readRoom.mockReset().mockImplementation(async () => document);
	storage = {
		put: vi.fn(async () => {}),
		get: vi.fn(async () => null),
		delete: vi.fn(async () => {}),
	};
	media = createMediaService(db.store, db.projects, storage);
	lifecycle = createMediaLifecycle(
		db.lifecycle,
		db.projects,
		storage,
		readRoom,
	);
});
const age = async (id: string) => {
	await db.query(
		"update media_asset set uploaded_at=now()-interval '8 days' where id=$1",
		[id],
	);
};

it("reports reserved storage including hidden pending writes", async () => {
	vi.mocked(storage.put).mockRejectedValueOnce(new Error("offline"));
	await expect(upload()).rejects.toThrow("offline");
	const state = await lifecycle.inspect("viewer", projectId);
	expect(state.storage).toMatchObject({
		files: 1,
		bytes: png().length,
		pendingFiles: 1,
		pendingBytes: png().length,
		maxFiles: 100,
		maxBytes: 104857600,
	});
	expect(state.usage[0]?.removable).toBe(false);
	expect(await lifecycle.cleanup()).toEqual({ removed: 0, deferred: 0 });
});
it("removes only unreferenced completed library uploads, releases quota, and safely retries deletion", async () => {
	const asset = await upload();
	expect((await lifecycle.inspect("owner", projectId)).usage[0]).toMatchObject({
		removable: true,
	});
	vi.mocked(storage.delete).mockRejectedValueOnce(new Error("R2 offline"));
	await expect(lifecycle.remove("editor", projectId, asset.id)).rejects.toThrow(
		"R2 offline",
	);
	expect((await lifecycle.inspect("owner", projectId)).storage).toMatchObject({
		files: 1,
		removingFiles: 1,
	});
	expect(await db.store.get(projectId, asset.id)).toBeNull();
	await expect(
		lifecycle.retain("owner", projectId, asset.id),
	).rejects.toMatchObject({ status: 409 });
	await expect(db.store.complete("owner", asset.id)).resolves.toBeNull();
	await lifecycle.remove("owner", projectId, asset.id);
	await lifecycle.remove("owner", projectId, asset.id);
	expect((await lifecycle.inspect("owner", projectId)).storage.files).toBe(0);
	const fresh = await upload();
	expect(fresh.id).not.toBe(asset.id);
});
it("retains canvas imports and pins library reuse before insertion, including subsequent delete and undo", async () => {
	const asset = await upload(false);
	await expect(
		lifecycle.remove("owner", projectId, asset.id),
	).rejects.toMatchObject({ status: 409 });
	({ projectId, otherProjectId } = await db.reset());
	const library = await upload();
	await lifecycle.retain("editor", projectId, library.id);
	await expect(
		lifecycle.remove("owner", projectId, library.id),
	).rejects.toMatchObject({ status: 409 });
	await age(library.id);
	expect((await lifecycle.cleanup()).removed).toBe(0);
	expect(storage.delete).not.toHaveBeenCalled();
});
it("uses the authoritative shared graph, including disconnected attachments, and fails closed on outages", async () => {
	const asset = await upload();
	await db.query("update project set canvas_room_id='room' where id=$1", [
		projectId,
	]);
	const node = createCanvasNode("image", { x: 0, y: 0 });
	node.data.assetId = asset.id;
	node.data.label = "Disconnected image";
	document.nodes.push(node);
	const usage = (await lifecycle.inspect("owner", projectId)).usage[0];
	expect(usage?.references).toContainEqual({
		kind: "canvas",
		label: "Disconnected image",
		nodeId: node.id,
	});
	await expect(
		lifecycle.remove("owner", projectId, asset.id),
	).rejects.toMatchObject({ status: 409 });
	document.nodes = [];
	readRoom.mockRejectedValue(new Error("unavailable"));
	expect((await lifecycle.inspect("owner", projectId)).graphAvailable).toBe(
		false,
	);
	await expect(
		lifecycle.remove("owner", projectId, asset.id),
	).rejects.toMatchObject({ status: 409 });
	await age(asset.id);
	expect((await lifecycle.cleanup()).removed).toBe(0);
	expect(storage.delete).not.toHaveBeenCalled();
});
it("sweeps after seven days, never touches recent uploads or uncertain writers, and resumes object deletion", async () => {
	const asset = await upload();
	expect((await lifecycle.cleanup()).removed).toBe(0);
	await age(asset.id);
	await db.query("insert into media_upload_write(id,asset_id) values($1,$2)", [
		crypto.randomUUID(),
		asset.id,
	]);
	expect((await lifecycle.cleanup()).removed).toBe(0);
	await db.query("delete from media_upload_write");
	vi.mocked(storage.delete).mockRejectedValueOnce(new Error("retry"));
	expect(await lifecycle.cleanup()).toEqual({ removed: 0, deferred: 1 });
	expect(await lifecycle.cleanup()).toEqual({ removed: 1, deferred: 0 });
});
it("cannot remove an otherwise-unused file when the shared canvas cannot be verified", async () => {
	const asset = await upload();
	await db.query("update project set canvas_room_id='room' where id=$1", [
		projectId,
	]);
	readRoom.mockRejectedValue(new Error("shared canvas unavailable"));
	const state = await lifecycle.inspect("owner", projectId);
	expect(state.graphAvailable).toBe(false);
	expect(state.usage[0]).toMatchObject({ removable: false });
	expect(state.usage[0]?.reason).toContain(
		"shared canvas could not be checked",
	);
	await expect(
		lifecycle.remove("owner", projectId, asset.id),
	).rejects.toMatchObject({ status: 409 });
	await age(asset.id);
	expect(await lifecycle.cleanup()).toEqual({ removed: 0, deferred: 1 });
	expect(storage.delete).not.toHaveBeenCalled();
	expect((await lifecycle.inspect("owner", projectId)).storage.files).toBe(1);
});
it("serializes retain and removal claims so only one can win", async () => {
	const asset = await upload();
	const [retained, removed] = await Promise.all([
		db.lifecycle.retain("owner", projectId, asset.id),
		db.lifecycle.claim(projectId, asset.id, "editor"),
	]);
	expect(retained ? removed === "retained" : removed === "deleting").toBe(true);
});
it("keeps stored generation inputs, selected historical outputs, graph plans and clip records", async () => {
	const asset = await upload();
	const runId = crypto.randomUUID();
	const nodeId = crypto.randomUUID();
	await db.query(
		`insert into generation_run(id,project_id,user_id,node_id,model_id,prompt,input_hash,status,credits,expires_at,kind,asset_id,completed_at) values($1,$2,'owner',$3,'image','prompt','hash','succeeded',1,now()+interval '1 hour','image',$4,now())`,
		[runId, projectId, nodeId, asset.id],
	);
	await db.query("update project set canvas_room_id='room' where id=$1", [
		projectId,
	]);
	const node = createCanvasNode("image", { x: 0, y: 0 });
	node.data.selectedRunId = runId;
	document.nodes = [node];
	const state = await lifecycle.inspect("viewer", projectId);
	expect(state.usage[0]?.references.some((r) => r.kind === "generation")).toBe(
		true,
	);
	expect(state.usage[0]?.references.some((r) => r.kind === "canvas")).toBe(
		true,
	);
	await expect(
		lifecycle.remove("owner", projectId, asset.id),
	).rejects.toMatchObject({ status: 409 });
	await age(asset.id);
	expect((await lifecycle.cleanup()).removed).toBe(0);
});
it("blocks legacy clients, viewer deletion, revoked membership, cross-project IDs and cross-origin writes", async () => {
	const asset = await upload();
	await expect(
		lifecycle.remove("viewer", projectId, asset.id),
	).rejects.toMatchObject({ status: 403 });
	await expect(
		lifecycle.remove("outsider", projectId, asset.id),
	).rejects.toMatchObject({ status: 404 });
	await expect(
		lifecycle.retain("outsider", otherProjectId, asset.id),
	).rejects.toMatchObject({ status: 409 });
	await db.revoke("editor");
	await expect(
		lifecycle.remove("editor", projectId, asset.id),
	).rejects.toMatchObject({ status: 404 });
	const handler = createMediaHandler({
		actor: async () => "owner",
		service: () => media,
		lifecycle: () => lifecycle,
	});
	const res = await handler(
		new Request("https://kousa.app/media", {
			method: "DELETE",
			headers: { origin: "https://other.test" },
		}),
		{ projectId, assetId: asset.id },
	);
	expect(res.status).toBe(403);
	await handler(new Request("https://kousa.app/media"), { projectId });
	expect(
		(await lifecycle.inspect("owner", projectId)).usage[0]?.reason,
	).toContain("offline undo");
	await expect(
		lifecycle.remove("owner", projectId, asset.id),
	).rejects.toMatchObject({ status: 409 });
});

it.each(["generation-input", "workflow-plan", "clip-plan"] as const)(
	"protects %s references after completion and rejects new references to tombstones",
	async (kind) => {
		const asset = await upload();
		const id = crypto.randomUUID();
		const nodeId = crypto.randomUUID();
		async function insert(assetId: string) {
			if (kind === "generation-input")
				await db.query(
					`insert into generation_run(id,project_id,user_id,node_id,model_id,prompt,input_hash,status,credits,expires_at,kind,resolved_inputs) values($1,$2,'owner',$3,'text','prompt','hash','failed',1,now(),'text',$4)`,
					[
						id,
						projectId,
						nodeId,
						JSON.stringify({ version: 1, image: { assetId } }),
					],
				);
			else if (kind === "workflow-plan")
				await db.query(
					`insert into graph_run(id,project_id,user_id,node_id,input_hash,plan,status,remaining_credits,expires_at) values($1,$2,'owner',$3,'hash',$4,'failed',0,now())`,
					[
						id,
						projectId,
						nodeId,
						JSON.stringify([{ kind: "video", image: { assetId } }]),
					],
				);
			else
				await db.query(
					`insert into clip_run(id,project_id,user_id,node_id,input_hash,plan,status,expires_at) values($1,$2,'owner',$3,'hash',$4,'failed',now())`,
					[
						id,
						projectId,
						nodeId,
						JSON.stringify({ videoAssetId: assetId, audioAssetId: assetId }),
					],
				);
		}
		await insert(asset.id);
		expect(
			(await lifecycle.inspect("owner", projectId)).usage[0]?.removable,
		).toBe(false);
		await age(asset.id);
		expect((await lifecycle.cleanup()).removed).toBe(0);
		await expect(
			lifecycle.remove("owner", projectId, asset.id),
		).rejects.toMatchObject({ status: 409 });
		// Deleting the record still leaves its media pinned for undo and saved plans.
		const table =
			kind === "generation-input"
				? "generation_run"
				: kind === "workflow-plan"
					? "graph_run"
					: "clip_run";
		await db.query(`delete from ${table} where id=$1`, [id]);
		await expect(
			lifecycle.remove("owner", projectId, asset.id),
		).rejects.toMatchObject({ status: 409 });
		const bytes = png();
		bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
		const removable = await media.upload(
			"owner",
			projectId,
			{ bytes, name: "other.png", mimeType: "image/png" },
			true,
		);
		await lifecycle.remove("owner", projectId, removable.id);
		await expect(insert(removable.id)).rejects.toThrow("Media was removed");
	},
);

it("an in-flight duplicate upload protects an already-ready file until the write settles", async () => {
	const asset = await upload();
	let finish: () => void = () => {};
	let started: () => void = () => {};
	const began = new Promise<void>((resolve) => {
		started = resolve;
	});
	vi.mocked(storage.put).mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
				started();
			}),
	);
	const request = upload();
	await began;
	await expect(
		lifecycle.remove("owner", projectId, asset.id),
	).rejects.toMatchObject({ status: 409 });
	finish();
	await request;
	await lifecycle.remove("owner", projectId, asset.id);
	expect(storage.delete).toHaveBeenCalledTimes(1);
});

it("migration defaults retain old assets and old reservations while new candidates require confirmed completion", async () => {
	const result = await db.query(
		"select reserve_media_asset($1,'owner',$2,'legacy.png','image/png',1,1,1,null) as id",
		[projectId, "0".repeat(64)],
	);
	const id = (result.rows[0] as { id: string }).id;
	await db.store.complete("owner", id);
	expect(
		(await lifecycle.inspect("owner", projectId)).usage[0]?.reason,
	).toContain("offline undo");
	await expect(lifecycle.remove("owner", projectId, id)).rejects.toMatchObject({
		status: 409,
	});
});
