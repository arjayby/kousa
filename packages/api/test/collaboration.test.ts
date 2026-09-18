import { createProjectTestDatabase } from "@kousa/db/testing-projects";
import { createCanvasNode, emptyCanvas } from "@kousa/projects/canvas";
import { readCanvasDocument } from "@kousa/projects/canvas-document";
import {
	type CollaborationProvider,
	createCollaborationService,
} from "@kousa/projects/collaboration";
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
import * as Y from "yjs";

let database: Awaited<ReturnType<typeof createProjectTestDatabase>>;
let projectId: string;
let doc: Y.Doc;
const setAccess = vi.fn<CollaborationProvider["setAccess"]>(async () => {});
const disconnect = vi.fn(async () => {});
const seed = vi.fn<CollaborationProvider["seed"]>(async (_room, update) => {
	Y.applyUpdate(doc, update);
});
const identify = vi.fn<CollaborationProvider["identify"]>(async (user) => ({
	body: JSON.stringify({ token: `test-${user.id}` }),
	status: 200,
}));
const backend: CollaborationProvider = {
	ensureRoom: vi.fn(async () => {}),
	setAccess,
	disconnect,
	seed,
	identify,
	read: async () => readCanvasDocument(doc).document,
};
const person = (id: string) => ({ id, name: id });
const options = {
	email: {
		isConfigured: () => true,
		send: async () => ({ messageId: "test" }),
	},
	appUrl: "https://kousa.app",
};
const collab = () => createCollaborationService(database.store, backend);
const projects = () =>
	createProjectService(database.store, { ...options, collaboration: collab() });
beforeAll(async () => {
	database = await createProjectTestDatabase();
	await database.addUsers(
		["owner", "editor", "viewer", "outsider"].map((id) => ({
			id,
			name: id,
			email: `${id}@example.test`,
		})),
	);
}, 30_000);
beforeEach(async () => {
	await database.clear();
	vi.clearAllMocks();
	doc = new Y.Doc();
	projectId = (await database.store.create("owner", "Collaboration test")).id;
	await database.addMember({ projectId, userId: "editor", role: "editor" });
	await database.addMember({ projectId, userId: "viewer", role: "viewer" });
});
afterAll(async () => {
	await database.close();
});

describe("collaboration authorization and migration with real project queries", () => {
	it("denies nonmembers before making any provider calls", async () => {
		await expect(
			collab().join(person("outsider"), { projectId }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(seed).not.toHaveBeenCalled();
		expect(identify).not.toHaveBeenCalled();
	});
	it.each(["owner", "editor", "viewer"])(
		"grants the database role to %s, ignoring supplied roles",
		async (id) => {
			await collab().join(person(id), {
				projectId,
				role: "owner",
				userId: "owner",
			});
			expect(setAccess).toHaveBeenLastCalledWith(`kousa-${projectId}`, id, id);
		},
	);
	it("migrates an existing graph and blocks legacy saves atomically", async () => {
		const document = {
			...emptyCanvas(),
			nodes: [createCanvasNode("text", { x: 12, y: 24 })],
		};
		await projects().saveCanvas("owner", {
			projectId,
			document,
			expectedRevision: 0,
		});
		await collab().join(person("editor"), { projectId });
		expect(readCanvasDocument(doc).document).toEqual(document);
		expect(
			await database.store.saveCanvas("owner", projectId, 1, emptyCanvas()),
		).toBeNull();
		expect(
			(await projects().getCanvas("viewer", { projectId })).document,
		).toEqual(document);
	});
	it("does not reseed after another user has edited the shared graph", async () => {
		await collab().join(person("owner"), { projectId });
		await collab().join(person("viewer"), { projectId });
		expect(seed).toHaveBeenCalledTimes(1);
	});
	it("retries the exact same binary seed after a lost provider response", async () => {
		seed.mockImplementationOnce(async (_room, update) => {
			Y.applyUpdate(doc, update);
			throw new Error("response lost");
		});
		await expect(collab().join(person("owner"), { projectId })).rejects.toThrow(
			"response lost",
		);
		await collab().join(person("owner"), { projectId });
		expect(seed.mock.calls[0]?.[1]).toEqual(seed.mock.calls[1]?.[1]);
		expect(identify).toHaveBeenCalledTimes(1);
	});
	it("serializes concurrent initialization so only one seed is created", async () => {
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		seed.mockImplementationOnce(async (_room, update) => {
			await barrier;
			Y.applyUpdate(doc, update);
		});
		const joining = collab().join(person("owner"), { projectId });
		await vi.waitFor(() => expect(seed).toHaveBeenCalled());
		await expect(
			collab().join(person("editor"), { projectId }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		release();
		await joining;
		await collab().join(person("editor"), { projectId });
		expect(seed).toHaveBeenCalledTimes(1);
	});
	it("revokes sockets before downgrading, then grants viewer access", async () => {
		await collab().join(person("editor"), { projectId });
		setAccess.mockClear();
		disconnect.mockImplementationOnce(async () => {
			expect((await database.store.get("editor", projectId))?.role).toBe(
				"editor",
			);
		});
		await projects().changeMember("owner", {
			projectId,
			userId: "editor",
			role: "viewer",
		});
		expect(setAccess.mock.calls.map((call) => call[2])).toEqual([
			null,
			"viewer",
		]);
		expect(disconnect).toHaveBeenCalledOnce();
		await collab().join(person("editor"), { projectId });
		expect(setAccess).toHaveBeenLastCalledWith(
			`kousa-${projectId}`,
			"editor",
			"viewer",
		);
	});
	it("prevents re-granting access after removal", async () => {
		await collab().join(person("editor"), { projectId });
		await projects().removeMember("owner", { projectId, userId: "editor" });
		await expect(
			collab().join(person("editor"), { projectId }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(setAccess).toHaveBeenLastCalledWith(
			`kousa-${projectId}`,
			"editor",
			null,
		);
	});
	it("does not report a removal as completed when socket revocation fails", async () => {
		await collab().join(person("editor"), { projectId });
		disconnect.mockRejectedValueOnce(new Error("provider unavailable"));
		await expect(
			projects().removeMember("owner", { projectId, userId: "editor" }),
		).rejects.toThrow("provider unavailable");
		expect((await database.store.get("editor", projectId))?.role).toBe(
			"editor",
		);
		await projects().removeMember("owner", { projectId, userId: "editor" });
		expect(await database.store.get("editor", projectId)).toBeNull();
	});
	it("keeps ordinary project roles usable before Liveblocks is configured", async () => {
		const service = createProjectService(database.store, {
			...options,
			collaboration: createCollaborationService(database.store, null),
		});
		await service.changeMember("owner", {
			projectId,
			userId: "editor",
			role: "viewer",
		});
		expect((await database.store.get("editor", projectId))?.role).toBe(
			"viewer",
		);
		await expect(
			createCollaborationService(database.store, null).join(person("owner"), {
				projectId,
			}),
		).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
	});
});

it("seeds distinct rooms and revokes membership in every canvas", async () => {
	const second = await projects().createCanvas("owner", {
		projectId,
		name: "Second",
	});
	const document = {
		...emptyCanvas(),
		nodes: [createCanvasNode("text", { x: 10, y: 20 })],
	};
	await projects().saveCanvas("owner", {
		projectId,
		canvasId: second.id,
		document,
		expectedRevision: 0,
	});
	await collab().join(person("editor"), { projectId });
	await collab().join(person("editor"), { projectId, canvasId: second.id });
	expect(seed.mock.calls.map(([room]) => room)).toEqual([
		`kousa-${projectId}`,
		`kousa-${second.id}`,
	]);
	const secondDoc = new Y.Doc();
	const update = seed.mock.calls[1]?.[1];
	if (!update) throw new Error("Missing second canvas seed");
	Y.applyUpdate(secondDoc, update);
	expect(readCanvasDocument(secondDoc).document).toEqual(document);
	secondDoc.destroy();
	setAccess.mockClear();
	await projects().removeMember("owner", { projectId, userId: "editor" });
	expect(setAccess).toHaveBeenCalledWith(`kousa-${projectId}`, "editor", null);
	expect(setAccess).toHaveBeenCalledWith(`kousa-${second.id}`, "editor", null);
	expect(disconnect).toHaveBeenCalledTimes(2);
	await expect(
		collab().join(person("editor"), { projectId, canvasId: second.id }),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("rejects a canvas from another project before contacting the provider", async () => {
	const foreign = await projects().create("owner", { name: "Other" });
	await expect(
		collab().join(person("owner"), { projectId, canvasId: foreign.id }),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expect(seed).not.toHaveBeenCalled();
	expect(identify).not.toHaveBeenCalled();
});
