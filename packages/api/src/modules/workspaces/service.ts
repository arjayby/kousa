import type { Database } from "@kousa/db";
import { sql, type SQL } from "drizzle-orm";
import { Data, Effect } from "effect";
import { z } from "zod";

import {
  invitationIdSchema,
  invitationSchema,
  invitationTokenSchema,
  issuedInvitationSchema,
  memberRoleSchema,
  memberSchema,
  roleSchema,
  successSchema,
  userIdSchema,
  websiteIdSchema,
  websiteSchema,
  workspaceSchema,
  type UserId,
  type WorkspaceId,
} from "./contract";

export class WorkspaceError extends Data.TaggedError("WorkspaceError")<{
  code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "BAD_REQUEST";
  message: string;
}> {}

export class WorkspacePersistenceError extends Data.TaggedError("WorkspacePersistenceError")<{
  cause: unknown;
}> {}

type WorkspaceActor = { db: Database; userId: UserId; workspaceId: WorkspaceId };

// Every membership/invitation mutation advances the Workspace revision. Each
// write compares the authorized revision and performs its dependent changes in
// one SQL statement. A concurrent change fails closed instead of using stale
// authorization, including on Neon HTTP, which has no interactive transactions.

const accessSchema = workspaceSchema.extend({
  ownerUserId: userIdSchema,
  revision: z.number().int(),
});

function rows<S extends z.ZodType>({ db, query, schema }: { db: Database; query: SQL; schema: S }) {
  return Effect.tryPromise({
    try: async () => z.array(schema).parse((await db.execute(query)).rows),
    catch: (cause) => new WorkspacePersistenceError({ cause }),
  });
}

export function authorizeWorkspace({ db, userId, workspaceId }: WorkspaceActor) {
  return Effect.gen(function* () {
    const [found] = yield* rows({
      db,
      schema: accessSchema,
      query: sql`
      SELECT w.id, w.name, w.owner_user_id AS "ownerUserId", w.revision,
        CASE WHEN w.owner_user_id = m.user_id THEN 'owner' ELSE m.role END AS role
      FROM workspace w JOIN membership m ON m.workspace_id = w.id
      WHERE w.id = ${workspaceId} AND m.user_id = ${userId}
    `,
    });
    if (!found)
      return yield* new WorkspaceError({ code: "NOT_FOUND", message: "Workspace not found" });
    return found;
  });
}

function ownerAccess(actor: WorkspaceActor) {
  return Effect.gen(function* () {
    const found = yield* authorizeWorkspace(actor);
    if (found.role !== "owner")
      return yield* new WorkspaceError({ code: "FORBIDDEN", message: "Owner permission required" });
    return found;
  });
}

function changed<S extends z.ZodType>(parameters: { db: Database; query: SQL; schema: S }) {
  return Effect.gen(function* () {
    const [result] = yield* rows(parameters);
    if (!result)
      return yield* new WorkspaceError({
        code: "CONFLICT",
        message: "Workspace changed. Refresh and try again.",
      });
    return result;
  });
}

function nonOwnerMember(actor: WorkspaceActor & { targetUserId: UserId }, ownerUserId: UserId) {
  return Effect.gen(function* () {
    if (actor.targetUserId === ownerUserId) {
      return yield* new WorkspaceError({
        code: "BAD_REQUEST",
        message: "Transfer ownership before changing the Owner's Membership",
      });
    }
    const [found] = yield* rows({
      db: actor.db,
      schema: z.object({ userId: userIdSchema }),
      query: sql`
      SELECT user_id AS "userId" FROM membership WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.targetUserId}
    `,
    });
    if (!found)
      return yield* new WorkspaceError({ code: "NOT_FOUND", message: "Member not found" });
    return found;
  });
}

export function listWorkspaces({ db, userId }: { db: Database; userId: UserId }) {
  return Effect.tryPromise({
    try: async () => {
      const result = await db.execute(sql`
        SELECT w.id, w.name,
          CASE WHEN w.owner_user_id = m.user_id THEN 'owner' ELSE m.role END AS role
        FROM workspace w JOIN membership m ON m.workspace_id = w.id
        WHERE m.user_id = ${userId} ORDER BY w.created_at, w.id
      `);
      return z.array(workspaceSchema).parse(result.rows);
    },
    catch: (cause) => new WorkspacePersistenceError({ cause }),
  });
}

export function createWorkspace({
  db,
  userId,
  name,
}: {
  db: Database;
  userId: UserId;
  name: string;
}) {
  return Effect.tryPromise({
    try: async () => {
      const id = crypto.randomUUID();
      const result = await db.execute(sql`
        WITH created AS (
          INSERT INTO workspace (id, name, owner_user_id)
          VALUES (${id}, ${name}, ${userId}) RETURNING id, name
        ), joined AS (
          INSERT INTO membership (workspace_id, user_id, role)
          SELECT id, ${userId}, 'admin' FROM created RETURNING workspace_id
        )
        SELECT created.id, created.name, 'owner' AS role FROM created JOIN joined ON joined.workspace_id = created.id
      `);
      return workspaceSchema.parse(result.rows[0]);
    },
    catch: (cause) => new WorkspacePersistenceError({ cause }),
  });
}

export function getWorkspace({
  db,
  userId,
  workspaceId,
}: {
  db: Database;
  userId: UserId;
  workspaceId: WorkspaceId;
}) {
  return authorizeWorkspace({ db, userId, workspaceId }).pipe(
    Effect.map((found) => workspaceSchema.parse(found)),
  );
}

export function renameWorkspace(actor: WorkspaceActor & { name: string }) {
  return Effect.gen(function* () {
    const current = yield* ownerAccess(actor);
    return yield* changed({
      db: actor.db,
      schema: workspaceSchema,
      query: sql`
      UPDATE workspace SET name = ${actor.name}, revision = revision + 1
      WHERE id = ${actor.workspaceId} AND revision = ${current.revision} AND owner_user_id = ${actor.userId}
      RETURNING id, name, 'owner' AS role
    `,
    });
  });
}

export function listMembers(actor: WorkspaceActor) {
  return Effect.gen(function* () {
    yield* ownerAccess(actor);
    return yield* rows({
      db: actor.db,
      schema: memberSchema,
      query: sql`
      SELECT m.user_id AS "userId", u.name, u.email,
        CASE WHEN w.owner_user_id = m.user_id THEN 'owner' ELSE m.role END AS role
      FROM membership m JOIN workspace w ON w.id = m.workspace_id JOIN "user" u ON u.id = m.user_id
      WHERE m.workspace_id = ${actor.workspaceId} ORDER BY u.name, u.id
    `,
    });
  });
}

export function setMemberRole(
  actor: WorkspaceActor & { targetUserId: UserId; role: z.infer<typeof memberRoleSchema> },
) {
  return Effect.gen(function* () {
    const current = yield* ownerAccess(actor);
    yield* nonOwnerMember(actor, current.ownerUserId);
    return yield* changed({
      db: actor.db,
      schema: successSchema,
      query: sql`
      WITH locked AS (
        UPDATE workspace SET revision = revision + 1
        WHERE id = ${actor.workspaceId} AND revision = ${current.revision} AND owner_user_id = ${actor.userId}
        RETURNING id, owner_user_id
      ), updated AS (
        UPDATE membership m SET role = ${actor.role} FROM locked
        WHERE m.workspace_id = locked.id AND m.user_id = ${actor.targetUserId} AND m.user_id <> locked.owner_user_id
        RETURNING m.user_id
      ) SELECT TRUE AS success FROM updated
    `,
    });
  });
}

export function removeMember(actor: WorkspaceActor & { targetUserId: UserId }) {
  return Effect.gen(function* () {
    const current = yield* ownerAccess(actor);
    yield* nonOwnerMember(actor, current.ownerUserId);
    return yield* deleteMembership(actor, current.revision);
  });
}

export function leaveWorkspace(actor: WorkspaceActor) {
  return Effect.gen(function* () {
    const current = yield* authorizeWorkspace(actor);
    if (current.role === "owner") {
      return yield* new WorkspaceError({
        code: "BAD_REQUEST",
        message: "Transfer ownership before leaving",
      });
    }
    return yield* deleteMembership({ ...actor, targetUserId: actor.userId }, current.revision);
  });
}

export function transferOwnership(actor: WorkspaceActor & { targetUserId: UserId }) {
  return Effect.gen(function* () {
    const current = yield* ownerAccess(actor);
    yield* nonOwnerMember(actor, current.ownerUserId);
    return yield* changed({
      db: actor.db,
      schema: successSchema,
      query: sql`
      WITH transferred AS (
        UPDATE workspace SET owner_user_id = ${actor.targetUserId}, revision = revision + 1
        WHERE id = ${actor.workspaceId} AND revision = ${current.revision} AND owner_user_id = ${actor.userId}
        RETURNING id
      ), demoted AS (
        UPDATE membership m SET role = 'admin' FROM transferred
        WHERE m.workspace_id = transferred.id AND m.user_id = ${actor.userId}
        RETURNING m.user_id
      ), cancelled AS (
        UPDATE invitation i SET status = 'revoked' FROM transferred
        WHERE i.workspace_id = transferred.id AND i.status = 'pending'
        RETURNING i.id
      ) SELECT TRUE AS success FROM demoted CROSS JOIN (SELECT count(*) FROM cancelled) cancellation
    `,
    });
  });
}

function deleteMembership(actor: WorkspaceActor & { targetUserId: UserId }, revision: number) {
  return changed({
    db: actor.db,
    schema: successSchema,
    query: sql`
    WITH locked AS (
      UPDATE workspace SET revision = revision + 1
      WHERE id = ${actor.workspaceId} AND revision = ${revision}
      RETURNING id, owner_user_id
    ), removed AS (
      DELETE FROM membership m USING locked
      WHERE m.workspace_id = locked.id AND m.user_id = ${actor.targetUserId} AND m.user_id <> locked.owner_user_id
      RETURNING m.user_id
    ) SELECT TRUE AS success FROM removed
  `,
  });
}

function newInvitationToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function hashInvitationToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function issueInvitation(
  actor: WorkspaceActor & { email: string; role: z.infer<typeof memberRoleSchema> },
) {
  return Effect.gen(function* () {
    const current = yield* ownerAccess(actor);
    const [member] = yield* rows({
      db: actor.db,
      schema: z.object({ userId: userIdSchema }),
      query: sql`
      SELECT m.user_id AS "userId" FROM membership m JOIN "user" u ON u.id = m.user_id
      WHERE m.workspace_id = ${actor.workspaceId} AND lower(u.email) = ${actor.email}
    `,
    });
    if (member)
      return yield* new WorkspaceError({
        code: "BAD_REQUEST",
        message: "This User is already a member. Use membership controls to change their Role.",
      });
    const token = newInvitationToken();
    const tokenHash = yield* Effect.promise(() => hashInvitationToken(token));
    const issued = yield* changed({
      db: actor.db,
      schema: invitationSchema,
      query: sql`
      WITH locked AS (
        UPDATE workspace SET revision = revision + 1
        WHERE id = ${actor.workspaceId} AND revision = ${current.revision} AND owner_user_id = ${actor.userId}
        RETURNING id
      ), cancelled AS (
        UPDATE invitation i SET status = 'revoked' FROM locked
        WHERE i.workspace_id = locked.id AND i.email = ${actor.email} AND i.status = 'pending'
        RETURNING i.id
      ), issued AS (
        INSERT INTO invitation (id, workspace_id, email, role, token_hash, expires_at)
        SELECT ${crypto.randomUUID()}, locked.id, ${actor.email}, ${actor.role}, ${tokenHash}, now() + interval '7 days'
        FROM locked CROSS JOIN (SELECT count(*) FROM cancelled) cancellation
        RETURNING id, workspace_id AS "workspaceId", email, role, to_json(expires_at) AS "expiresAt", status
      ) SELECT * FROM issued
    `,
    });
    return issuedInvitationSchema.parse({ ...issued, token });
  });
}

export function listInvitations(actor: WorkspaceActor) {
  return Effect.gen(function* () {
    yield* ownerAccess(actor);
    return yield* rows({
      db: actor.db,
      schema: invitationSchema,
      query: sql`
      SELECT id, workspace_id AS "workspaceId", email, role, to_json(expires_at) AS "expiresAt", status
      FROM invitation WHERE workspace_id = ${actor.workspaceId} AND status = 'pending' AND expires_at > now()
      ORDER BY created_at, id
    `,
    });
  });
}

export function revokeInvitation(
  actor: WorkspaceActor & { invitationId: z.infer<typeof invitationIdSchema> },
) {
  return Effect.gen(function* () {
    const current = yield* ownerAccess(actor);
    const [pending] = yield* rows({
      db: actor.db,
      schema: invitationSchema,
      query: sql`
      SELECT id, workspace_id AS "workspaceId", email, role, to_json(expires_at) AS "expiresAt", status
      FROM invitation WHERE workspace_id = ${actor.workspaceId} AND id = ${actor.invitationId} AND status = 'pending'
    `,
    });
    if (!pending)
      return yield* new WorkspaceError({ code: "NOT_FOUND", message: "Invitation not found" });
    return yield* changed({
      db: actor.db,
      schema: successSchema,
      query: sql`
      WITH locked AS (
        UPDATE workspace SET revision = revision + 1
        WHERE id = ${actor.workspaceId} AND revision = ${current.revision} AND owner_user_id = ${actor.userId}
        RETURNING id
      ), revoked AS (
        UPDATE invitation i SET status = 'revoked' FROM locked
        WHERE i.workspace_id = locked.id AND i.id = ${actor.invitationId} AND i.status = 'pending'
        RETURNING i.id
      ) SELECT TRUE AS success FROM revoked
    `,
    });
  });
}

export function acceptInvitation({
  db,
  userId,
  token,
  enabled,
}: {
  db: Database;
  userId: UserId;
  token: z.infer<typeof invitationTokenSchema>;
  enabled: boolean;
}) {
  return Effect.gen(function* () {
    if (!enabled)
      return yield* new WorkspaceError({
        code: "FORBIDDEN",
        message: "Invitation acceptance is unavailable until email delivery is configured",
      });
    const [recipient] = yield* rows({
      db,
      schema: z.object({ email: z.email(), emailVerified: z.boolean() }),
      query: sql`
      SELECT email, email_verified AS "emailVerified" FROM "user" WHERE id = ${userId}
    `,
    });
    if (!recipient?.emailVerified)
      return yield* new WorkspaceError({
        code: "FORBIDDEN",
        message: "Verify your email before accepting invitations",
      });
    const tokenHash = yield* Effect.promise(() => hashInvitationToken(token));
    const [pending] = yield* rows({
      db,
      schema: invitationSchema.extend({ revision: z.number().int(), name: z.string() }),
      query: sql`
      SELECT i.id, i.workspace_id AS "workspaceId", i.email, i.role, to_json(i.expires_at) AS "expiresAt", i.status, w.revision, w.name
      FROM invitation i JOIN workspace w ON w.id = i.workspace_id
      WHERE i.token_hash = ${tokenHash} AND i.email = ${recipient.email.toLowerCase()} AND i.status = 'pending' AND i.expires_at > now()
    `,
    });
    if (!pending)
      return yield* new WorkspaceError({
        code: "BAD_REQUEST",
        message: "Invitation is invalid or unavailable",
      });
    const [existing] = yield* rows({
      db,
      schema: z.object({ userId: userIdSchema }),
      query: sql`
      SELECT user_id AS "userId" FROM membership WHERE workspace_id = ${pending.workspaceId} AND user_id = ${userId}
    `,
    });
    if (existing)
      return yield* new WorkspaceError({
        code: "BAD_REQUEST",
        message: "You are already a member of this Workspace",
      });
    return yield* changed({
      db,
      schema: workspaceSchema,
      query: sql`
      WITH locked AS (
        UPDATE workspace SET revision = revision + 1
        WHERE id = ${pending.workspaceId} AND revision = ${pending.revision}
        RETURNING id, name
      ), claimed AS (
        UPDATE invitation i SET status = 'accepted' FROM locked
        WHERE i.id = ${pending.id} AND i.workspace_id = locked.id AND i.status = 'pending' AND i.expires_at > now()
        RETURNING i.workspace_id, i.role
      ), joined AS (
        INSERT INTO membership (workspace_id, user_id, role)
        SELECT workspace_id, ${userId}, role FROM claimed RETURNING workspace_id, role
      ) SELECT locked.id, locked.name, joined.role FROM locked JOIN joined ON joined.workspace_id = locked.id
    `,
    });
  });
}

export function authorizeWebsite(
  actor: WorkspaceActor & {
    websiteId: z.infer<typeof websiteIdSchema>;
    permission: "view" | "configure";
  },
) {
  return Effect.gen(function* () {
    const [found] = yield* rows({
      db: actor.db,
      schema: websiteSchema.extend({ role: roleSchema }),
      query: sql`
      SELECT s.id, s.workspace_id AS "workspaceId",
        CASE WHEN w.owner_user_id = m.user_id THEN 'owner' ELSE m.role END AS role
      FROM website s JOIN workspace w ON w.id = s.workspace_id JOIN membership m ON m.workspace_id = w.id
      WHERE s.id = ${actor.websiteId} AND s.workspace_id = ${actor.workspaceId} AND m.user_id = ${actor.userId}
    `,
    });
    if (!found)
      return yield* new WorkspaceError({ code: "NOT_FOUND", message: "Website not found" });
    if (actor.permission === "configure" && found.role === "viewer") {
      return yield* new WorkspaceError({
        code: "FORBIDDEN",
        message: "Website management permission required",
      });
    }
    return websiteSchema.parse(found);
  });
}
