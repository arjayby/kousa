import { createProjectTestDatabase } from "@kousa/db/testing-projects";
import { createCanvasNode, emptyCanvas } from "@kousa/projects/canvas";
import { readCanvasDocument } from "@kousa/projects/canvas-document";
import { createCollaborationService } from "@kousa/projects/collaboration";
import { createProjectService } from "@kousa/projects/service";
import { createTemplateService } from "@kousa/projects/templates";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { Context } from "../src/context";
import { createTemplatesRouter } from "../src/routers/templates";

function contextFor(id: string | null): Context {
	const date = new Date();
	return {
		auth: null,
		session: id
			? {
					user: {
						id,
						name: id,
						email: `${id}@example.test`,
						emailVerified: false,
						image: null,
						createdAt: date,
						updatedAt: date,
					},
					session: {
						id: `session-${id}`,
						userId: id,
						token: `test-only-${id}`,
						expiresAt: new Date(Date.now() + 60_000),
						createdAt: date,
						updatedAt: date,
						ipAddress: null,
						userAgent: null,
					},
				}
			: null,
	};
}

let db: Awaited<ReturnType<typeof createProjectTestDatabase>>;
let projects: ReturnType<typeof createProjectService>;
let service: ReturnType<typeof createTemplateService>;
let projectId: string;
const email = {
	isConfigured: () => false,
	send: async () => ({ messageId: null }),
};
const actor = (id: string | null) =>
	createRouterClient(
		createTemplatesRouter(() => service),
		{ context: contextFor(id) },
	);
function graph() {
	const text = createCanvasNode("text", { x: 0, y: 0 });
	text.data.content = "Coffee campaign";
	const image = createCanvasNode("image", { x: 400, y: 0 });
	image.data.assetId = crypto.randomUUID();
	image.data.imageSource = "project";
	return {
		version: 1 as const,
		nodes: [text, image],
		edges: [
			{
				id: crypto.randomUUID(),
				source: text.id,
				target: image.id,
				sourceHandle: "output" as const,
				targetHandle: "prompt",
			},
		],
	};
}
const saveInput = () => ({
	id: crypto.randomUUID(),
	projectId,
	name: "Coffee promo",
});
beforeAll(async () => {
	db = await createProjectTestDatabase();
	await db.addUsers(
		["owner", "editor", "viewer", "outsider"].map((id) => ({
			id,
			name: id,
			email: `${id}@example.test`,
		})),
	);
}, 30000);
afterAll(async () => {
	await db.close();
});
beforeEach(async () => {
	await db.clear();
	await db.clearTemplates();
	projects = createProjectService(db.store, {
		email,
		appUrl: "https://example.test",
	});
	service = createTemplateService(db.templates, projects);
	projectId = (await projects.create("owner", { name: "Source" })).id;
	await db.addMember({ projectId, userId: "editor", role: "editor" });
	await db.addMember({ projectId, userId: "viewer", role: "viewer" });
	await projects.saveCanvas("owner", {
		projectId,
		expectedRevision: 0,
		document: graph(),
	});
});
it("requires authentication for every template endpoint", async () => {
	const templateId = crypto.randomUUID();
	for (const request of [
		() => actor(null).list(),
		() => actor(null).save(saveInput()),
		() => actor(null).rename({ templateId, name: "X" }),
		() => actor(null).remove({ templateId }),
		() =>
			actor(null).createProject({
				id: crypto.randomUUID(),
				templateId,
				name: "X",
			}),
	]) {
		await expect(request()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	}
});
it("lets owners and editors save private snapshots; denies viewers and outsiders", async () => {
	const saved = await actor("owner").save(saveInput());
	await actor("editor").save(saveInput());
	expect(await actor("owner").list()).toHaveLength(1);
	expect(await actor("editor").list()).toHaveLength(1);
	expect(await actor("viewer").list()).toHaveLength(0);
	expect(await actor("outsider").list()).toHaveLength(0);
	await expect(actor("viewer").save(saveInput())).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(actor("outsider").save(saveInput())).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
	for (const other of ["editor", "viewer", "outsider"]) {
		await expect(
			actor(other).rename({ templateId: saved.id, name: "Stolen" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			actor(other).remove({ templateId: saved.id }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			actor(other).createProject({
				id: crypto.randomUUID(),
				templateId: saved.id,
				name: "Stolen",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	}
	expect((await actor("owner").list())[0]).not.toHaveProperty("document");
});
it("reads the server graph, strips forged ownership and payloads, and rejects invalid names/IDs", async () => {
	const input = saveInput();
	await actor("editor").save({
		...input,
		ownerId: "owner",
		document: emptyCanvas(),
	} as typeof input);
	const saved = await db.templates.get("editor", input.id);
	expect(saved?.ownerId).toBe("editor");
	expect(saved?.nodeCount).toBe(2);
	for (const patch of [
		{ name: "   " },
		{ name: "x".repeat(121) },
		{ projectId: "wrong" },
		{ id: "wrong" },
	])
		await expect(
			actor("owner").save({ ...saveInput(), ...patch }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await projects.saveCanvas("owner", {
		projectId,
		expectedRevision: 1,
		document: emptyCanvas(),
	});
	await expect(actor("owner").save(saveInput())).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
});
it("creates independent projects atomically with fresh graphs and no shared access or media", async () => {
	const source = await projects.getCanvas("owner", { projectId });
	const saved = await actor("owner").save(saveInput());
	const first = await actor("owner").createProject({
		id: crypto.randomUUID(),
		templateId: saved.id,
		name: "Tea promo",
	});
	const second = await actor("owner").createProject({
		id: crypto.randomUUID(),
		templateId: saved.id,
		name: "Cocoa promo",
	});
	const a = await projects.getCanvas("owner", { projectId: first.id });
	const b = await projects.getCanvas("owner", { projectId: second.id });
	expect(a.document.nodes).toHaveLength(2);
	expect(a.document.edges).toHaveLength(1);
	expect(a.document.nodes[0]?.data.content).toBe("Coffee campaign");
	expect(a.document.nodes[1]?.data).toMatchObject({ imageSource: "generated" });
	expect(a.document.nodes[1]?.data.assetId).toBeUndefined();
	expect(
		new Set(
			[...a.document.nodes, ...b.document.nodes, ...source.document.nodes].map(
				(n) => n.id,
			),
		).size,
	).toBe(6);
	await expect(
		projects.get("editor", { projectId: first.id }),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	const rows = await db.templateProjects();
	const row = rows.find((p) => p.id === first.id);
	expect(row).toMatchObject({
		ownerId: "owner",
		canvasRoomId: null,
		canvasSeed: null,
		canvasReady: false,
		canvasRevision: 0,
	});
	await projects.saveCanvas("owner", {
		projectId: first.id,
		expectedRevision: 0,
		document: emptyCanvas(),
	});
	expect(
		(await projects.getCanvas("owner", { projectId: second.id })).document
			.nodes,
	).toHaveLength(2);
	expect((await projects.getCanvas("owner", { projectId })).document).toEqual(
		source.document,
	);
});
it("retries saves and project creation once, even after names change or templates are deleted", async () => {
	const input = saveInput();
	await Promise.all([actor("owner").save(input), actor("owner").save(input)]);
	await actor("owner").rename({ templateId: input.id, name: "Renamed" });
	await actor("owner").save(input);
	expect(await actor("owner").list()).toHaveLength(1);
	await expect(
		actor("owner").save({ ...input, name: "Changed" }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	await expect(actor("editor").save(input)).rejects.toMatchObject({
		code: "CONFLICT",
	});
	const request = {
		id: crypto.randomUUID(),
		templateId: input.id,
		name: "Copy",
	};
	await Promise.all([
		actor("owner").createProject(request),
		actor("owner").createProject(request),
	]);
	expect(await db.templateProjects()).toHaveLength(2);
	await projects.rename("owner", {
		projectId: request.id,
		name: "Changed later",
	});
	await actor("owner").remove({ templateId: input.id });
	expect(await actor("owner").createProject(request)).toEqual({
		id: request.id,
	});
	await expect(
		actor("owner").createProject({ ...request, name: "Changed" }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	await expect(actor("owner").save(input)).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
});
it("deletes templates without deleting created projects and permits safe delete retries", async () => {
	const saved = await actor("owner").save(saveInput());
	const copy = await actor("owner").createProject({
		id: crypto.randomUUID(),
		templateId: saved.id,
		name: "Copy",
	});
	await actor("owner").remove({ templateId: saved.id });
	await actor("owner").remove({ templateId: saved.id });
	expect(await actor("owner").list()).toEqual([]);
	expect((await db.templates.get("owner", saved.id))?.document).toBeNull();
	expect(
		(await projects.getCanvas("owner", { projectId: copy.id })).document.nodes,
	).toHaveLength(2);
	await expect(
		actor("owner").rename({ templateId: saved.id, name: "Resurrect" }),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	await expect(
		actor("owner").createProject({
			id: crypto.randomUUID(),
			templateId: saved.id,
			name: "Copy",
		}),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("rechecks editor access at the write after a slow shared-canvas read", async () => {
	service = createTemplateService(db.templates, {
		get: projects.get,
		getCanvas: async (...args) => {
			const result = await projects.getCanvas(...args);
			await db.store.removeMember("owner", projectId, "editor");
			return result;
		},
	});
	await expect(actor("editor").save(saveInput())).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	expect(await actor("editor").list()).toEqual([]);
});
it("keeps an editor's previously saved template usable after source access is revoked", async () => {
	const saved = await actor("editor").save(saveInput());
	await db.store.removeMember("owner", projectId, "editor");
	const copy = await actor("editor").createProject({
		id: crypto.randomUUID(),
		templateId: saved.id,
		name: "Private copy",
	});
	expect((await projects.get("editor", { projectId: copy.id })).role).toBe(
		"owner",
	);
	await expect(
		projects.get("owner", { projectId: copy.id }),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("enforces the library limit atomically and frees space after deletion", async () => {
	const doc = graph();
	for (let i = 0; i < 99; i++)
		expect(
			await db.templates.save("owner", {
				id: crypto.randomUUID(),
				projectId,
				requestHash: String(i),
				name: `Template ${i}`,
				document: doc,
			}),
		).toBe("CREATED");
	const requests = [saveInput(), saveInput()];
	const results = await Promise.allSettled(
		requests.map((input) => actor("owner").save(input)),
	);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	expect(await actor("owner").list()).toHaveLength(100);
	const entry = (await actor("owner").list())[0];
	if (!entry) throw new Error("Missing template");
	await actor("owner").remove({ templateId: entry.id });
	await actor("owner").save(saveInput());
	expect(await actor("owner").list()).toHaveLength(100);
});
it("captures the live shared graph and seeds copies into separate collaboration rooms", async () => {
	const rooms = new Map<string, Y.Doc>();
	const access = vi.fn(async () => {});
	const collaboration = createCollaborationService(db.store, {
		ensureRoom: async (roomId) => {
			if (!rooms.has(roomId)) rooms.set(roomId, new Y.Doc());
		},
		seed: async (roomId, update) => {
			const doc = rooms.get(roomId);
			if (!doc) throw new Error("Missing room");
			Y.applyUpdate(doc, update);
		},
		setAccess: access,
		disconnect: async () => {},
		identify: async () => ({ body: "{}", status: 200 }),
		read: async (roomId) => {
			const doc = rooms.get(roomId);
			if (!doc) throw new Error("Missing room");
			return readCanvasDocument(doc).document;
		},
	});
	projects = createProjectService(db.store, {
		email,
		appUrl: "https://example.test",
		collaboration,
	});
	service = createTemplateService(db.templates, projects);
	const owner = { id: "owner", name: "Owner" };
	await collaboration.join(owner, { projectId });
	const source = rooms.get(`kousa-${projectId}`);
	if (!source) throw new Error("Missing source");
	const nodes = source.getMap<Y.Map<unknown>>("kousa:nodes:v1");
	const text = [...nodes.values()]
		.find((n) => n.get("type") === "text")
		?.get("content");
	if (!(text instanceof Y.Text)) throw new Error("Missing text");
	text.insert(0, "Live: ");
	const saved = await actor("owner").save(saveInput());
	const copy = await actor("owner").createProject({
		id: crypto.randomUUID(),
		templateId: saved.id,
		name: "Shared copy",
	});
	await collaboration.join(owner, { projectId: copy.id });
	expect(rooms.size).toBe(2);
	expect(
		(
			await projects.getCanvas("owner", { projectId: copy.id })
		).document.nodes.find((n) => n.type === "text")?.data.content,
	).toBe("Live: Coffee campaign");
	expect(access).toHaveBeenLastCalledWith(`kousa-${copy.id}`, "owner", "owner");
	for (const doc of rooms.values()) doc.destroy();
});
