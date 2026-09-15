import {
	createProjectTestDatabase,
	testLegacyInvitationMigration,
} from "@kousa/db/testing-projects";
import { type EmailContent, EmailDeliveryError } from "@kousa/email/sender";
import { createProjectService, hashInviteToken } from "@kousa/projects/service";
import { createRouterClient } from "@orpc/server";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Context } from "../src/context";
import { createProjectsRouter } from "../src/routers/projects";

let database: Awaited<ReturnType<typeof createProjectTestDatabase>>;
let service: ReturnType<typeof createProjectService>;
let projectId: string;
const emails: EmailContent[] = [];
const sendEmail = vi.fn(async (message: EmailContent) => {
	emails.push(message);
	return { messageId: "test-message" };
});
async function issue(
	role: "viewer" | "editor" = "viewer",
	email = "outsider@example.test",
	expiresInDays: 1 | 7 | 30 = 7,
) {
	const result = await owner.createInvite({
		projectId,
		email,
		role,
		expiresInDays,
	});
	const token = emails.at(-1)?.text.match(/\/invite#([a-f0-9]{64})/)?.[1];
	if (!token) throw new Error("No invitation in the test mailbox.");
	return { ...result, token };
}

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
	service = createProjectService(database.store, {
		email: { isConfigured: () => true, send: sendEmail },
		appUrl: "https://kousa.app",
	});
	await database.addUsers(
		["owner", "editor", "viewer", "outsider", "second"].map((id) => ({
			id,
			name: id,
			email: `${id}@example.test`,
			emailVerified: true,
		})),
	);
}, 30_000);

beforeEach(async () => {
	await database.clear();
	emails.length = 0;
	sendEmail.mockReset().mockImplementation(async (message) => {
		emails.push(message);
		return { messageId: "test-message" };
	});
	await database.updateUser("outsider", {
		email: "outsider@example.test",
		emailVerified: true,
	});
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
				actor.createInvite({
					projectId,
					email: "outsider@example.test",
					role: "editor",
				}),
			).rejects.toMatchObject({ code });
			await expect(
				actor.changeMember({ projectId, userId: "viewer", role: "editor" }),
			).rejects.toMatchObject({ code });
			await expect(
				actor.removeMember({ projectId, userId: "editor" }),
			).rejects.toMatchObject({ code });
			const invite = await issue();
			await expect(
				actor.resendInvite({ projectId, inviteId: invite.id }),
			).rejects.toMatchObject({ code });
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
		const invite = await issue();
		for (const operation of [
			() => anonymous.list({}),
			() => anonymous.create({ name: "No" }),
			() => anonymous.get({ projectId }),
			() => anonymous.rename({ projectId, name: "No" }),
			() => anonymous.access({ projectId }),
			() =>
				anonymous.changeMember({ projectId, userId: "viewer", role: "editor" }),
			() => anonymous.removeMember({ projectId, userId: "viewer" }),
			() =>
				anonymous.createInvite({
					projectId,
					email: "outsider@example.test",
					role: "viewer",
				}),
			() => anonymous.resendInvite({ projectId, inviteId: invite.id }),
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

describe("email-targeted invitations", () => {
	it("sends a role-specific unique link only to the normalized email, without returning the token", async () => {
		const sent = await owner.createInvite({
			projectId,
			email: "  OUTSIDER@Example.Test  ",
			role: "editor",
			expiresInDays: 1,
		});
		expect(sent).toMatchObject({
			email: "outsider@example.test",
			deliveryStatus: "sent",
		});
		expect(sent).not.toHaveProperty("token");
		expect(emails).toHaveLength(1);
		expect(emails[0]).toMatchObject({ to: "outsider@example.test" });
		expect(emails[0]?.text).toContain("First film as an editor");
		const token = emails[0]?.text.match(/\/invite#([a-f0-9]{64})/)?.[1] ?? "";
		const [stored] = await database.invitations();
		expect(stored?.tokenHash).toBe(await hashInviteToken(token));
		expect(JSON.stringify(stored)).not.toContain(token);
		expect(stored?.expiresAt.getTime()).toBeGreaterThan(
			Date.now() + 23 * 3600_000,
		);
		expect(stored?.expiresAt.getTime()).toBeLessThan(
			Date.now() + 25 * 3600_000,
		);
		expect(await outsider.previewInvite({ token })).toMatchObject({
			role: "editor",
			requiresEmailVerification: false,
		});
		const access = await owner.access({ projectId });
		expect(access.invites.items[0]).toMatchObject({
			email: "outsider@example.test",
			role: "editor",
			status: "pending",
			deliveryStatus: "sent",
		});
		expect(JSON.stringify(access)).not.toContain(token);
		expect(JSON.stringify(access)).not.toContain(stored?.tokenHash);
	});
	it.each(["viewer", "editor"] as const)(
		"grants the invited %s role to the matching verified account",
		async (role) => {
			const invitation = await issue(role);
			await expect(
				client("second").previewInvite({ token: invitation.token }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
			await expect(
				client("second").acceptInvite({
					token: invitation.token,
					email: "outsider@example.test",
				} as { token: string }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
			await expect(outsider.get({ projectId })).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
			await outsider.acceptInvite({ token: invitation.token });
			expect((await outsider.get({ projectId })).role).toBe(role);
			expect(
				(await owner.access({ projectId })).invites.items[0],
			).toMatchObject({ status: "accepted", email: "outsider@example.test" });
			await expect(
				outsider.acceptInvite({ token: invitation.token }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		},
	);
	it("checks verified email in the database rather than trusting stale session fields", async () => {
		const invite = await issue();
		await database.updateUser("outsider", { emailVerified: false });
		expect(await outsider.previewInvite({ token: invite.token })).toMatchObject(
			{ requiresEmailVerification: true },
		);
		await expect(
			outsider.acceptInvite({ token: invite.token }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect((await database.invitations())[0]?.acceptedAt).toBeNull();
		await database.updateUser("outsider", { emailVerified: true });
		await outsider.acceptInvite({ token: invite.token });
		expect((await outsider.get({ projectId })).role).toBe("viewer");
	});
	it("rejects a changed account email even when the session still has the invited address", async () => {
		const invite = await issue();
		await database.updateUser("outsider", { email: "changed@example.test" });
		await expect(
			outsider.acceptInvite({ token: invite.token }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect((await database.invitations())[0]?.acceptedAt).toBeNull();
	});
	it("supports accounts created after an invitation", async () => {
		const invite = await issue("editor", "future@example.test");
		await database.addUsers([
			{
				id: "future",
				name: "Future",
				email: "future@example.test",
				emailVerified: true,
			},
		]);
		await client("future").acceptInvite({ token: invite.token });
		expect((await client("future").get({ projectId })).role).toBe("editor");
	});
	it("rejects owner and existing-collaborator invitations without sending email", async () => {
		for (const email of [
			"owner@example.test",
			"editor@example.test",
			"viewer@example.test",
		]) {
			await expect(
				owner.createInvite({ projectId, email, role: "editor" }),
			).rejects.toMatchObject({ code: "CONFLICT" });
		}
		expect(sendEmail).not.toHaveBeenCalled();
	});
	it("rejects invalid and missing email, owner roles, and unsupported expiration", async () => {
		for (const email of [
			"",
			"not-email",
			"x@example.test\r\nBcc: attacker@example.test",
		]) {
			await expect(
				owner.createInvite({ projectId, email, role: "viewer" }),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
		await expect(
			// @ts-expect-error Simulate an untrusted client without an email.
			owner.createInvite({ projectId, role: "viewer" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			owner.createInvite({
				projectId,
				email: "outsider@example.test",
				// @ts-expect-error Owner cannot be an invitation role.
				role: "owner",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			owner.createInvite({
				projectId,
				email: "outsider@example.test",
				role: "viewer",
				// @ts-expect-error Expiration is limited to supported durations.
				expiresInDays: 365,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(sendEmail).not.toHaveBeenCalled();
	});
	it("prevents duplicate pending invitations, including simultaneous creates", async () => {
		const results = await Promise.allSettled([
			owner.createInvite({
				projectId,
				email: "outsider@example.test",
				role: "viewer",
			}),
			owner.createInvite({
				projectId,
				email: "OUTSIDER@example.test",
				role: "editor",
			}),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(emails).toHaveLength(1);
		expect(await database.invitations()).toHaveLength(1);
	});
	it("allows only one simultaneous acceptance of the same invitation", async () => {
		const invite = await issue();
		const results = await Promise.allSettled([
			outsider.acceptInvite({ token: invite.token }),
			outsider.acceptInvite({ token: invite.token }),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			(await owner.access({ projectId })).members.filter(
				(member) => member.userId === "outsider",
			),
		).toHaveLength(1);
	});
	it("shows expired and revoked invitations and rejects their links", async () => {
		const expired = await issue();
		await database.expireInvite(expired.id);
		const revoked = await issue("editor", "second@example.test");
		await owner.revokeInvite({ projectId, inviteId: revoked.id });
		const entries = (await owner.access({ projectId })).invites.items;
		expect(entries.find((item) => item.id === expired.id)?.status).toBe(
			"expired",
		);
		expect(entries.find((item) => item.id === revoked.id)?.status).toBe(
			"revoked",
		);
		await expect(
			outsider.acceptInvite({ token: expired.token }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			client("second").acceptInvite({ token: revoked.token }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
	it("resends with a fresh token, the same role, and renewed expiry", async () => {
		const invite = await issue("editor", "outsider@example.test", 30);
		await expect(
			owner.resendInvite({ projectId, inviteId: invite.id }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await database.ageInvite(invite.id);
		await owner.resendInvite({ projectId, inviteId: invite.id });
		const token =
			emails.at(-1)?.text.match(/\/invite#([a-f0-9]{64})/)?.[1] ?? "";
		expect(token).not.toBe(invite.token);
		expect(await database.invitations()).toHaveLength(1);
		await expect(
			outsider.acceptInvite({ token: invite.token }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await outsider.acceptInvite({ token });
		expect((await outsider.get({ projectId })).role).toBe("editor");
	});
	it("serializes simultaneous resends so only one current email is sent", async () => {
		const invite = await issue();
		await database.ageInvite(invite.id);
		const results = await Promise.allSettled([
			owner.resendInvite({ projectId, inviteId: invite.id }),
			owner.resendInvite({ projectId, inviteId: invite.id }),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(emails).toHaveLength(2);
	});
	it("keeps failed delivery visible and permits an explicit retry", async () => {
		sendEmail.mockRejectedValueOnce(new EmailDeliveryError("not_configured"));
		const invite = await owner.createInvite({
			projectId,
			email: "outsider@example.test",
			role: "viewer",
		});
		expect(invite).toMatchObject({
			deliveryStatus: "failed",
			deliveryError: "not_configured",
		});
		expect((await owner.access({ projectId })).invites.items[0]).toMatchObject({
			status: "pending",
			deliveryStatus: "failed",
			canResend: true,
		});
		await owner.resendInvite({ projectId, inviteId: invite.id });
		expect((await owner.access({ projectId })).invites.items[0]).toMatchObject({
			deliveryStatus: "sent",
			deliveryError: null,
		});
	});
	it("does not persist raw provider errors or let an old delivery result overwrite a resend", async () => {
		sendEmail.mockRejectedValueOnce(
			new Error("provider echoed a secret token"),
		);
		const failed = await owner.createInvite({
			projectId,
			email: "outsider@example.test",
			role: "viewer",
		});
		const oldHash = (await database.invitations())[0]?.tokenHash ?? "";
		expect(failed.deliveryError).toBe("unconfirmed");
		expect(JSON.stringify(await database.invitations())).not.toContain(
			"provider echoed",
		);
		await owner.resendInvite({ projectId, inviteId: failed.id });
		await database.store.completeDelivery(failed.id, oldHash, {
			error: "rejected",
		});
		expect(
			(await owner.access({ projectId })).invites.items[0]?.deliveryStatus,
		).toBe("sent");
	});
	it("preserves a current member role if another access path added them before acceptance", async () => {
		const invite = await issue("editor");
		await database.addMember({ projectId, userId: "outsider", role: "viewer" });
		await outsider.acceptInvite({ token: invite.token });
		expect((await outsider.get({ projectId })).role).toBe("viewer");
	});
	it("prevents replay after removal and allows the owner to issue a new invitation", async () => {
		const invite = await issue();
		await outsider.acceptInvite({ token: invite.token });
		await owner.removeMember({ projectId, userId: "outsider" });
		await expect(
			outsider.acceptInvite({ token: invite.token }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const fresh = await issue("editor");
		expect(fresh.id).toBe(invite.id);
		await outsider.acceptInvite({ token: fresh.token });
		expect((await outsider.get({ projectId })).role).toBe("editor");
	});
	it("does not allow another project's owner to revoke or resend an invitation", async () => {
		const invite = await issue();
		const other = await outsider.create({ name: "Other" });
		await expect(
			outsider.revokeInvite({ projectId: other.id, inviteId: invite.id }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			outsider.resendInvite({ projectId: other.id, inviteId: invite.id }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await outsider.previewInvite({ token: invite.token })).toMatchObject(
			{ role: "viewer" },
		);
	});
	it("paginates invitation statuses without hiding older records", async () => {
		for (let i = 0; i < 21; i++)
			await issue("viewer", `person${i}@example.test`);
		const first = (await owner.access({ projectId })).invites;
		const second = (await owner.access({ projectId, offset: 20 })).invites;
		expect(first.items).toHaveLength(20);
		expect(first.hasMore).toBe(true);
		expect(second.items).toHaveLength(1);
		expect(second.hasMore).toBe(false);
		expect(
			new Set([...first.items, ...second.items].map((item) => item.id)).size,
		).toBe(21);
	});
});

it("migrates legacy links by disabling unclaimed invitations while retaining accepted memberships", async () => {
	const result = await testLegacyInvitationMigration();
	const pending = result.invites.find(
		(invite) => invite.tokenHash === "legacy-pending",
	);
	const accepted = result.invites.find(
		(invite) => invite.tokenHash === "legacy-accepted",
	);
	expect(pending?.revokedAt).toBeInstanceOf(Date);
	expect(pending?.email).toBeNull();
	expect(accepted?.acceptedBy).toBe("member");
	expect(accepted?.revokedAt).toBeNull();
	expect(result.members).toHaveLength(1);
	expect(result.members[0]?.role).toBe("viewer");
}, 30_000);
