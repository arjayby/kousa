import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { createRouterClient } from "@orpc/server";
import { appRouter } from "@kousa/api/routers/index";
import { authorizeWebsite } from "@kousa/api/modules/workspaces/service";
import { userIdSchema, websiteIdSchema } from "@kousa/api/modules/workspaces/contract";
import { Effect } from "effect";

import { workspaceFixture } from "./helpers/workspaces";

test("signup creates no Workspace and explicit creation grants its creator the Owner role", async (t) => {
  const fixture = workspaceFixture(t);
  const alice = await fixture.signUp("Alice Owner");
  assert.deepEqual(await alice.client.workspaces.list(), []);

  const created = await alice.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(created.id);
  assert.equal(created.name, "Acme");
  assert.equal(created.role, "owner");
  assert.deepEqual(await alice.client.workspaces.list(), [created]);
});

test("workspace reads and lists reveal only the signed-in User's Memberships", async (t) => {
  const fixture = workspaceFixture(t);
  const alice = await fixture.signUp("Alice Owner");
  const bob = await fixture.signUp("Bob Outsider");
  const acme = await alice.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  const clients = await alice.client.workspaces.create({ name: "Clients" });
  fixture.workspaceIds.push(clients.id);
  assert.deepEqual(await alice.client.workspaces.get({ workspaceId: acme.id }), acme);
  assert.deepEqual(await alice.client.workspaces.list(), [acme, clients]);
  assert.deepEqual(await bob.client.workspaces.list(), []);
  await assert.rejects(bob.client.workspaces.get({ workspaceId: acme.id }), {
    code: "NOT_FOUND",
    message: "Workspace not found",
  });
  await assert.rejects(bob.client.workspaces.get({ workspaceId: crypto.randomUUID() }), {
    code: "NOT_FOUND",
    message: "Workspace not found",
  });
});

test("only the Owner can rename a Workspace, while roles remain independent across Workspaces", async (t) => {
  const fixture = workspaceFixture(t);
  const alice = await fixture.signUp("Alice Owner");
  const bob = await fixture.signUp("Bob Admin");
  const viewer = await fixture.signUp("Vera Viewer");
  const acme = await alice.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  await fixture.seedMember({ workspaceId: acme.id, userId: bob.session.user.id, role: "admin" });
  await fixture.seedMember({
    workspaceId: acme.id,
    userId: viewer.session.user.id,
    role: "viewer",
  });
  const bobSpace = await bob.client.workspaces.create({ name: "Bob's Workspace" });
  fixture.workspaceIds.push(bobSpace.id);

  await assert.rejects(bob.client.workspaces.rename({ workspaceId: acme.id, name: "Stolen" }), {
    code: "FORBIDDEN",
  });
  await assert.rejects(viewer.client.workspaces.rename({ workspaceId: acme.id, name: "Stolen" }), {
    code: "FORBIDDEN",
  });
  assert.equal((await bob.client.workspaces.get({ workspaceId: acme.id })).role, "admin");
  assert.equal((await bob.client.workspaces.get({ workspaceId: bobSpace.id })).role, "owner");
  await alice.client.workspaces.rename({ workspaceId: acme.id, name: "Acme Team" });
  assert.equal((await viewer.client.workspaces.get({ workspaceId: acme.id })).name, "Acme Team");
});

test("only the Owner can list the team and change non-owner roles, and active sessions use the new role", async (t) => {
  const fixture = workspaceFixture(t);
  const alice = await fixture.signUp("Alice Owner");
  const bob = await fixture.signUp("Bob Admin");
  const acme = await alice.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  await fixture.seedMember({ workspaceId: acme.id, userId: bob.session.user.id, role: "admin" });

  assert.deepEqual(
    (await alice.client.workspaces.members({ workspaceId: acme.id })).map(({ name, role }) => ({
      name,
      role,
    })),
    [
      { name: "Alice Owner", role: "owner" },
      { name: "Bob Admin", role: "admin" },
    ],
  );
  await assert.rejects(bob.client.workspaces.members({ workspaceId: acme.id }), {
    code: "FORBIDDEN",
  });
  await assert.rejects(
    bob.client.workspaces.setRole({
      workspaceId: acme.id,
      targetUserId: alice.session.user.id,
      role: "viewer",
    }),
    { code: "FORBIDDEN" },
  );
  await alice.client.workspaces.setRole({
    workspaceId: acme.id,
    targetUserId: bob.session.user.id,
    role: "viewer",
  });
  assert.equal((await bob.client.workspaces.get({ workspaceId: acme.id })).role, "viewer");
  await assert.rejects(
    alice.client.workspaces.setRole({
      workspaceId: acme.id,
      targetUserId: alice.session.user.id,
      role: "viewer",
    }),
    { code: "BAD_REQUEST" },
  );
  assert.equal((await alice.client.workspaces.get({ workspaceId: acme.id })).role, "owner");
});

test("removal revokes the active session's Workspace access without removing other Memberships or signing out", async (t) => {
  const fixture = workspaceFixture(t);
  const alice = await fixture.signUp("Alice Owner");
  const bob = await fixture.signUp("Bob Admin");
  const acme = await alice.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  const personal = await bob.client.workspaces.create({ name: "Bob's Workspace" });
  fixture.workspaceIds.push(personal.id);
  await fixture.seedMember({ workspaceId: acme.id, userId: bob.session.user.id, role: "admin" });
  await assert.rejects(
    bob.client.workspaces.removeMember({
      workspaceId: acme.id,
      targetUserId: alice.session.user.id,
    }),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    alice.client.workspaces.removeMember({
      workspaceId: acme.id,
      targetUserId: alice.session.user.id,
    }),
    { code: "BAD_REQUEST" },
  );
  await alice.client.workspaces.removeMember({
    workspaceId: acme.id,
    targetUserId: bob.session.user.id,
  });
  await assert.rejects(bob.client.workspaces.get({ workspaceId: acme.id }), { code: "NOT_FOUND" });
  assert.deepEqual(await bob.client.workspaces.list(), [personal]);
  assert.equal((await alice.client.workspaces.members({ workspaceId: acme.id })).length, 1);
  assert.equal(
    (await fixture.auth.api.getSession({ headers: new Headers({ Cookie: bob.cookie }) }))?.user.id,
    bob.session.user.id,
  );
});

test("non-owner members can leave while the Owner must transfer ownership first", async (t) => {
  const fixture = workspaceFixture(t);
  const alice = await fixture.signUp("Alice Owner");
  const bob = await fixture.signUp("Bob Viewer");
  const acme = await alice.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  await fixture.seedMember({ workspaceId: acme.id, userId: bob.session.user.id, role: "viewer" });
  await assert.rejects(alice.client.workspaces.leave({ workspaceId: acme.id }), {
    code: "BAD_REQUEST",
  });
  await bob.client.workspaces.leave({ workspaceId: acme.id });
  assert.deepEqual(await bob.client.workspaces.list(), []);
  assert.equal((await alice.client.workspaces.get({ workspaceId: acme.id })).role, "owner");
});

test("concurrent ownership transfers preserve exactly one Owner and demote the former Owner to Admin", async (t) => {
  const fixture = workspaceFixture(t);
  const alice = await fixture.signUp("Alice Owner");
  const bob = await fixture.signUp("Bob Admin");
  const vera = await fixture.signUp("Vera Viewer");
  const acme = await alice.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  await fixture.seedMember({ workspaceId: acme.id, userId: bob.session.user.id, role: "admin" });
  await fixture.seedMember({ workspaceId: acme.id, userId: vera.session.user.id, role: "viewer" });
  await assert.rejects(
    bob.client.workspaces.transferOwnership({
      workspaceId: acme.id,
      targetUserId: vera.session.user.id,
    }),
    { code: "FORBIDDEN" },
  );
  const transfers = await Promise.allSettled([
    fixture
      .independentClient(alice.session)
      .workspaces.transferOwnership({ workspaceId: acme.id, targetUserId: bob.session.user.id }),
    fixture
      .independentClient(alice.session)
      .workspaces.transferOwnership({ workspaceId: acme.id, targetUserId: vera.session.user.id }),
  ]);
  assert.equal(transfers.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await alice.client.workspaces.get({ workspaceId: acme.id })).role, "admin");
  const roles = await Promise.all([
    bob.client.workspaces.get({ workspaceId: acme.id }),
    vera.client.workspaces.get({ workspaceId: acme.id }),
  ]);
  assert.equal(roles.filter((item) => item.role === "owner").length, 1);
  await assert.rejects(
    alice.client.workspaces.rename({ workspaceId: acme.id, name: "Former Owner" }),
    { code: "FORBIDDEN" },
  );
});

test("PostgreSQL rejects removal of the sole Owner's Membership", async (t) => {
  const fixture = workspaceFixture(t);
  const alice = await fixture.signUp("Alice Owner");
  const acme = await alice.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  await assert.rejects(
    fixture.db.execute(
      sql`DELETE FROM membership WHERE workspace_id = ${acme.id} AND user_id = ${alice.session.user.id}`,
    ),
  );
  assert.equal((await alice.client.workspaces.get({ workspaceId: acme.id })).role, "owner");
});

test("only Owners can issue and list email-targeted seven-day Invitations", async (t) => {
  const fixture = workspaceFixture(t);
  const alice = await fixture.signUp("Alice Owner");
  const bob = await fixture.signUp("Bob Admin");
  const acme = await alice.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  await fixture.seedMember({ workspaceId: acme.id, userId: bob.session.user.id, role: "admin" });
  await assert.rejects(
    bob.client.workspaces.invite({
      workspaceId: acme.id,
      email: "invitee@example.test",
      role: "viewer",
    }),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(bob.client.workspaces.invitations({ workspaceId: acme.id }), {
    code: "FORBIDDEN",
  });
  const invite = await alice.client.workspaces.invite({
    workspaceId: acme.id,
    email: "Invitee@Example.test",
    role: "viewer",
  });
  assert.equal(invite.email, "invitee@example.test");
  assert.equal(invite.role, "viewer");
  assert.match(invite.token, /^[a-f0-9]{64}$/);
  const validity = Date.parse(invite.expiresAt) - Date.now();
  assert.ok(validity > 604790000 && validity <= 604800000);
  const listed = await alice.client.workspaces.invitations({ workspaceId: acme.id });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, invite.id);
  assert.equal("token" in (listed[0] ?? {}), false);
});

test("Invitation acceptance requires the verified recipient and grants membership once", async (t) => {
  const fixture = workspaceFixture(t);
  const alice = await fixture.signUp("Alice Owner");
  const invitee = await fixture.signUp("Invited Viewer");
  const stranger = await fixture.signUp("Another User");
  const acme = await alice.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  const invite = await alice.client.workspaces.invite({
    workspaceId: acme.id,
    email: invitee.email,
    role: "viewer",
  });
  await assert.rejects(invitee.client.workspaces.acceptInvitation({ token: invite.token }), {
    code: "FORBIDDEN",
  });
  await fixture.verifyEmail(stranger);
  await assert.rejects(stranger.client.workspaces.acceptInvitation({ token: invite.token }), {
    code: "BAD_REQUEST",
  });
  await fixture.verifyEmail(invitee);
  const joined = await invitee.client.workspaces.acceptInvitation({ token: invite.token });
  assert.deepEqual(joined, { id: acme.id, name: "Acme", role: "viewer" });
  assert.deepEqual(await invitee.client.workspaces.list(), [joined]);
  await assert.rejects(invitee.client.workspaces.acceptInvitation({ token: invite.token }), {
    code: "BAD_REQUEST",
  });
  assert.equal((await alice.client.workspaces.members({ workspaceId: acme.id })).length, 2);
});

test("replacing an Invitation invalidates its previous link and grants only the replacement role", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const invitee = await fixture.signUp("Invitee");
  const acme = await owner.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  const first = await owner.client.workspaces.invite({
    workspaceId: acme.id,
    email: invitee.email,
    role: "viewer",
  });
  const replacement = await owner.client.workspaces.invite({
    workspaceId: acme.id,
    email: invitee.email,
    role: "admin",
  });
  await fixture.verifyEmail(invitee);
  await assert.rejects(invitee.client.workspaces.acceptInvitation({ token: first.token }), {
    code: "BAD_REQUEST",
  });
  assert.equal(
    (await invitee.client.workspaces.acceptInvitation({ token: replacement.token })).role,
    "admin",
  );
});

test("revoked and expired Invitations cannot grant membership, and revocation cannot cross Workspaces", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const invitee = await fixture.signUp("Invitee");
  const acme = await owner.client.workspaces.create({ name: "Acme" });
  const other = await owner.client.workspaces.create({ name: "Other" });
  fixture.workspaceIds.push(acme.id, other.id);
  await fixture.verifyEmail(invitee);
  const revoked = await owner.client.workspaces.invite({
    workspaceId: acme.id,
    email: invitee.email,
    role: "viewer",
  });
  await assert.rejects(
    owner.client.workspaces.revokeInvitation({ workspaceId: other.id, invitationId: revoked.id }),
    { code: "NOT_FOUND" },
  );
  await owner.client.workspaces.revokeInvitation({
    workspaceId: acme.id,
    invitationId: revoked.id,
  });
  await assert.rejects(invitee.client.workspaces.acceptInvitation({ token: revoked.token }), {
    code: "BAD_REQUEST",
  });
  const expired = await owner.client.workspaces.invite({
    workspaceId: acme.id,
    email: invitee.email,
    role: "admin",
  });
  await fixture.db.execute(
    sql`UPDATE invitation SET expires_at = now() - interval '1 day' WHERE id = ${expired.id}`,
  );
  await assert.rejects(invitee.client.workspaces.acceptInvitation({ token: expired.token }), {
    code: "BAD_REQUEST",
  });
  assert.deepEqual(await invitee.client.workspaces.list(), []);
});

test("inviting an existing member cannot overwrite their Role", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const member = await fixture.signUp("Member");
  const acme = await owner.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  await fixture.seedMember({ workspaceId: acme.id, userId: member.session.user.id, role: "admin" });
  await assert.rejects(
    owner.client.workspaces.invite({ workspaceId: acme.id, email: member.email, role: "viewer" }),
    { code: "BAD_REQUEST" },
  );
  assert.equal((await member.client.workspaces.get({ workspaceId: acme.id })).role, "admin");
  assert.deepEqual(await owner.client.workspaces.invitations({ workspaceId: acme.id }), []);
});

test("ownership transfer cancels every pending Invitation", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const nextOwner = await fixture.signUp("Next Owner");
  const invitee = await fixture.signUp("Invitee");
  const acme = await owner.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  await fixture.seedMember({
    workspaceId: acme.id,
    userId: nextOwner.session.user.id,
    role: "viewer",
  });
  const invitation = await owner.client.workspaces.invite({
    workspaceId: acme.id,
    email: invitee.email,
    role: "admin",
  });
  await owner.client.workspaces.invite({
    workspaceId: acme.id,
    email: "another@example.test",
    role: "viewer",
  });
  await owner.client.workspaces.transferOwnership({
    workspaceId: acme.id,
    targetUserId: nextOwner.session.user.id,
  });
  assert.deepEqual(await nextOwner.client.workspaces.invitations({ workspaceId: acme.id }), []);
  await fixture.verifyEmail(invitee);
  await assert.rejects(invitee.client.workspaces.acceptInvitation({ token: invitation.token }), {
    code: "BAD_REQUEST",
  });
});

test("concurrent acceptance grants one Membership and production acceptance fails closed", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const invitee = await fixture.signUp("Invitee");
  const acme = await owner.client.workspaces.create({ name: "Acme" });
  fixture.workspaceIds.push(acme.id);
  await fixture.verifyEmail(invitee);
  const invitation = await owner.client.workspaces.invite({
    workspaceId: acme.id,
    email: invitee.email,
    role: "admin",
  });
  const productionClient = createRouterClient(appRouter, {
    context: {
      db: fixture.db,
      session: invitee.session,
      invitationAcceptanceEnabled: false,
      billingEnabled: true,
      trackingScript: { url: null, allowLocalHttp: false },
      reportFailure: () => undefined,
    },
  });
  await assert.rejects(productionClient.workspaces.acceptInvitation({ token: invitation.token }), {
    code: "FORBIDDEN",
  });
  const results = await Promise.allSettled([
    fixture
      .independentClient(invitee.session)
      .workspaces.acceptInvitation({ token: invitation.token }),
    fixture
      .independentClient(invitee.session)
      .workspaces.acceptInvitation({ token: invitation.token }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await owner.client.workspaces.members({ workspaceId: acme.id })).length, 2);
  assert.equal((await invitee.client.workspaces.get({ workspaceId: acme.id })).role, "admin");
});

test("Website access requires both current Membership and the matching Workspace", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const viewer = await fixture.signUp("Viewer");
  const outsider = await fixture.signUp("Outsider");
  const acme = await owner.client.workspaces.create({ name: "Acme" });
  const other = await owner.client.workspaces.create({ name: "Other" });
  fixture.workspaceIds.push(acme.id, other.id);
  await fixture.seedMember({
    workspaceId: acme.id,
    userId: viewer.session.user.id,
    role: "viewer",
  });
  const websiteId = crypto.randomUUID();
  await fixture.db.execute(
    sql`INSERT INTO website (id, workspace_id, name, hostname, public_tracking_id) VALUES (${websiteId}, ${acme.id}, 'Seeded', 'example.com', ${crypto.randomUUID()})`,
  );
  assert.deepEqual(await viewer.client.workspaces.website({ workspaceId: acme.id, websiteId }), {
    id: websiteId,
    workspaceId: acme.id,
  });
  await assert.rejects(owner.client.workspaces.website({ workspaceId: other.id, websiteId }), {
    code: "NOT_FOUND",
    message: "Website not found",
  });
  await assert.rejects(outsider.client.workspaces.website({ workspaceId: acme.id, websiteId }), {
    code: "NOT_FOUND",
    message: "Website not found",
  });
  await assert.rejects(
    viewer.client.workspaces.website({ workspaceId: acme.id, websiteId: crypto.randomUUID() }),
    { code: "NOT_FOUND", message: "Website not found" },
  );
  await owner.client.workspaces.removeMember({
    workspaceId: acme.id,
    targetUserId: viewer.session.user.id,
  });
  await assert.rejects(viewer.client.workspaces.website({ workspaceId: acme.id, websiteId }), {
    code: "NOT_FOUND",
  });
});

test("the reusable Website operation allows Owner and Admin configuration but rejects Viewer access after downgrade", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const admin = await fixture.signUp("Admin");
  const workspace = await owner.client.workspaces.create({ name: "Team" });
  fixture.workspaceIds.push(workspace.id);
  await fixture.seedMember({
    workspaceId: workspace.id,
    userId: admin.session.user.id,
    role: "admin",
  });
  const websiteId = websiteIdSchema.parse(crypto.randomUUID());
  await fixture.db.execute(
    sql`INSERT INTO website (id, workspace_id, name, hostname, public_tracking_id) VALUES (${websiteId}, ${workspace.id}, 'Seeded', 'example.com', ${crypto.randomUUID()})`,
  );
  const configure = (userId: string) =>
    Effect.runPromise(
      authorizeWebsite({
        db: fixture.db,
        userId: userIdSchema.parse(userId),
        workspaceId: workspace.id,
        websiteId,
        permission: "configure",
      }),
    );
  assert.deepEqual(await configure(owner.session.user.id), {
    id: websiteId,
    workspaceId: workspace.id,
  });
  assert.deepEqual(await configure(admin.session.user.id), {
    id: websiteId,
    workspaceId: workspace.id,
  });
  await owner.client.workspaces.setRole({
    workspaceId: workspace.id,
    targetUserId: admin.session.user.id,
    role: "viewer",
  });
  await assert.rejects(configure(admin.session.user.id), { code: "FORBIDDEN" });
  assert.deepEqual(
    await admin.client.workspaces.website({ workspaceId: workspace.id, websiteId }),
    { id: websiteId, workspaceId: workspace.id },
  );
});

test("authentication, validation, and tenant checks protect Workspace mutations", async (t) => {
  const fixture = workspaceFixture(t);
  const owner = await fixture.signUp("Owner");
  const otherOwner = await fixture.signUp("Other Owner");
  const otherMember = await fixture.signUp("Other Member");
  const acme = await owner.client.workspaces.create({ name: "Acme" });
  const other = await otherOwner.client.workspaces.create({ name: "Other" });
  fixture.workspaceIds.push(acme.id, other.id);
  await fixture.seedMember({
    workspaceId: other.id,
    userId: otherMember.session.user.id,
    role: "viewer",
  });
  const anonymous = createRouterClient(appRouter, {
    context: {
      db: fixture.db,
      session: null,
      invitationAcceptanceEnabled: true,
      billingEnabled: false,
      trackingScript: { url: null, allowLocalHttp: true },
      reportFailure: () => undefined,
    },
  });
  await assert.rejects(anonymous.workspaces.list(), { code: "UNAUTHORIZED" });
  await assert.rejects(anonymous.workspaces.create({ name: "Anonymous" }), {
    code: "UNAUTHORIZED",
  });
  await assert.rejects(owner.client.workspaces.create({ name: "   " }), { code: "BAD_REQUEST" });
  await assert.rejects(
    otherOwner.client.workspaces.rename({ workspaceId: acme.id, name: "Stolen" }),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    owner.client.workspaces.setRole({
      workspaceId: acme.id,
      targetUserId: otherMember.session.user.id,
      role: "admin",
    }),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    owner.client.workspaces.transferOwnership({
      workspaceId: acme.id,
      targetUserId: otherMember.session.user.id,
    }),
    { code: "NOT_FOUND" },
  );
  assert.equal((await otherMember.client.workspaces.get({ workspaceId: other.id })).role, "viewer");
});
