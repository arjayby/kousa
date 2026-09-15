import { createProjectTestDatabase } from "@kousa/db/testing-projects";
import { createProjectService } from "@kousa/projects/service";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../src/context";
import { createProjectsRouter } from "../src/routers/projects";

let database: Awaited<ReturnType<typeof createProjectTestDatabase>>;
let service: ReturnType<typeof createProjectService>;
let projectId: string;

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

const client = (id: string | null) =>
	createRouterClient(
		createProjectsRouter(() => service),
		{ context: contextFor(id) },
	);
const owner = client("owner");
const editor = client("editor");
const viewer = client("viewer");
const outsider = client("outsider");

beforeAll(async () => {
	database = await createProjectTestDatabase();
	service = createProjectService(database.store);
	await database.addUsers(
		["owner", "editor", "viewer", "outsider", "second"].map((id) => ({
			id,
			name: id,
			email: `${id}@example.test`,
		})),
	);
}, 30_000);

beforeEach(async () => {
	await database.clear();
	projectId = (await owner.create({ name: "First film" })).id;
	await database.addMember({ projectId, userId: "editor", role: "editor" });
	await database.addMember({ projectId, userId: "viewer", role: "viewer" });
});
afterAll(async () => {
	await database.close();
});

describe("project permissions through the oRPC router", () => {
	it("binds ownership to the session and trims names", async () => {
		const input = {
			name: "  My film  ",
			ownerId: "outsider",
			userId: "outsider",
		};
		const created = await owner.create(input);
		expect(await owner.get({ projectId: created.id })).toMatchObject({
			name: "My film",
			role: "owner",
			permissions: { canEdit: true, canManageAccess: true },
		});
		await expect(outsider.get({ projectId: created.id })).rejects.toMatchObject(
			{ code: "NOT_FOUND" },
		);
	});
	it("lists only owned and shared projects", async () => {
		await outsider.create({ name: "Private" });
		expect((await owner.list({})).items.map((p) => p.id)).toEqual([projectId]);
		expect((await editor.list({})).items.map((p) => p.role)).toEqual([
			"editor",
		]);
		expect((await viewer.list({})).items.map((p) => p.role)).toEqual([
			"viewer",
		]);
		expect((await outsider.list({})).items.map((p) => p.name)).toEqual([
			"Private",
		]);
	});
	it("paginates without hiding older projects", async () => {
		await Promise.all(
			Array.from({ length: 21 }, (_, i) => owner.create({ name: `Film ${i}` })),
		);
		const first = await owner.list({ offset: 0 });
		const second = await owner.list({ offset: 20 });
		expect(first.items).toHaveLength(20);
		expect(first.hasMore).toBe(true);
		expect(second.items).toHaveLength(2);
		expect(second.hasMore).toBe(false);
		expect(
			new Set([...first.items, ...second.items].map((p) => p.id)).size,
		).toBe(22);
	});
	it("allows an editor to rename but keeps a viewer read-only", async () => {
		await editor.rename({ projectId, name: "Edited film" });
		expect(await viewer.get({ projectId })).toMatchObject({
			name: "Edited film",
			role: "viewer",
			permissions: { canEdit: false, canManageAccess: false },
		});
		await expect(
			viewer.rename({ projectId, name: "No" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			outsider.rename({ projectId, name: "No" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
	it.each(["editor", "viewer", "outsider"])(
		"prevents %s from managing access",
		async (id) => {
			const actor = client(id);
			const code = id === "outsider" ? "NOT_FOUND" : "FORBIDDEN";
			await expect(actor.access({ projectId })).rejects.toMatchObject({ code });
			await expect(
				actor.createInvite({ projectId, role: "editor" }),
			).rejects.toMatchObject({ code });
			await expect(
				actor.changeMember({ projectId, userId: "viewer", role: "editor" }),
			).rejects.toMatchObject({ code });
			await expect(
				actor.removeMember({ projectId, userId: "editor" }),
			).rejects.toMatchObject({ code });
			const invite = await owner.createInvite({ projectId, role: "viewer" });
			await expect(
				actor.revokeInvite({ projectId, inviteId: invite.id }),
			).rejects.toMatchObject({ code });
		},
	);
	it("applies downgrades and revocation on subsequent requests", async () => {
		await owner.changeMember({ projectId, userId: "editor", role: "viewer" });
		await expect(
			editor.rename({ projectId, name: "No" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await owner.removeMember({ projectId, userId: "editor" });
		await expect(editor.get({ projectId })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect((await editor.list({})).items).toEqual([]);
		await owner.changeMember({ projectId, userId: "viewer", role: "editor" });
		await viewer.rename({ projectId, name: "Promoted" });
	});
	it("never removes or demotes the owner", async () => {
		await expect(
			owner.removeMember({ projectId, userId: "owner" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			owner.changeMember({ projectId, userId: "owner", role: "viewer" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect((await owner.get({ projectId })).role).toBe("owner");
	});
	it("requires authentication for every project operation", async () => {
		const anonymous = client(null);
		const invite = await owner.createInvite({ projectId, role: "viewer" });
		for (const operation of [
			() => anonymous.list({}),
			() => anonymous.create({ name: "No" }),
			() => anonymous.get({ projectId }),
			() => anonymous.rename({ projectId, name: "No" }),
			() => anonymous.access({ projectId }),
			() =>
				anonymous.changeMember({ projectId, userId: "viewer", role: "editor" }),
			() => anonymous.removeMember({ projectId, userId: "viewer" }),
			() => anonymous.createInvite({ projectId, role: "viewer" }),
			() => anonymous.revokeInvite({ projectId, inviteId: invite.id }),
			() => anonymous.previewInvite({ token: invite.token }),
			() => anonymous.acceptInvite({ token: invite.token }),
		])
			await expect(operation()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
	it("rejects invalid names, IDs, and role escalation", async () => {
		for (const name of ["   ", "x".repeat(121)])
			await expect(owner.create({ name })).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
		await expect(owner.get({ projectId: "not-a-uuid" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await expect(
			// @ts-expect-error Untrusted clients can submit values outside the TypeScript union.
			owner.changeMember({ projectId, userId: "viewer", role: "owner" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

describe("single-use invitations", () => {
	it("stores only a token hash and previews without granting access", async () => {
		const invite = await owner.createInvite({ projectId, role: "editor" });
		const rows = await database.invitations();
		expect(JSON.stringify(rows)).not.toContain(invite.token);
		expect(rows[0]?.tokenHash).toHaveLength(64);
		expect(await outsider.previewInvite({ token: invite.token })).toMatchObject(
			{ name: "First film", role: "editor" },
		);
		await expect(outsider.get({ projectId })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		const access = await owner.access({ projectId });
		expect(JSON.stringify(access)).not.toContain(invite.token);
		expect(JSON.stringify(access)).not.toContain(rows[0]?.tokenHash);
	});
	it.each(["editor", "viewer"] as const)(
		"grants only the invited %s role",
		async (role) => {
			const invite = await owner.createInvite({ projectId, role });
			expect(await outsider.acceptInvite({ token: invite.token })).toEqual({
				projectId,
			});
			expect((await outsider.get({ projectId })).role).toBe(role);
			await expect(
				client("second").acceptInvite({ token: invite.token }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		},
	);
	it("permits exactly one concurrent redemption", async () => {
		const invite = await owner.createInvite({ projectId, role: "viewer" });
		const results = await Promise.allSettled([
			outsider.acceptInvite({ token: invite.token }),
			client("second").acceptInvite({ token: invite.token }),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect((await owner.access({ projectId })).members).toHaveLength(3);
	});
	it("rejects revoked, expired, and invented links", async () => {
		const revoked = await owner.createInvite({ projectId, role: "viewer" });
		await owner.revokeInvite({ projectId, inviteId: revoked.id });
		const expired = await owner.createInvite({ projectId, role: "viewer" });
		await database.expireInvite(expired.id);
		for (const token of [revoked.token, expired.token, "0".repeat(64)]) {
			await expect(outsider.previewInvite({ token })).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
			await expect(outsider.acceptInvite({ token })).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		}
	});
	it("does not change an existing member's role through an old invite", async () => {
		const invite = await owner.createInvite({ projectId, role: "editor" });
		await viewer.acceptInvite({ token: invite.token });
		expect((await viewer.get({ projectId })).role).toBe("viewer");
	});
	it("cannot reuse an accepted link to regain revoked access", async () => {
		const invite = await owner.createInvite({ projectId, role: "viewer" });
		await outsider.acceptInvite({ token: invite.token });
		await owner.removeMember({ projectId, userId: "outsider" });
		await expect(
			outsider.acceptInvite({ token: invite.token }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
	it("does not let the owner consume or downgrade themselves through an invite", async () => {
		const invite = await owner.createInvite({ projectId, role: "viewer" });
		await expect(
			owner.acceptInvite({ token: invite.token }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await outsider.acceptInvite({ token: invite.token });
		expect((await owner.get({ projectId })).role).toBe("owner");
	});
	it("does not revoke an invite belonging to a different project", async () => {
		const other = await owner.create({ name: "Other" });
		const invite = await owner.createInvite({
			projectId: other.id,
			role: "viewer",
		});
		await expect(
			owner.revokeInvite({ projectId, inviteId: invite.id }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await outsider.acceptInvite({ token: invite.token });
	});
});
