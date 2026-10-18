import type { Database } from "@kousa/db";
import { sql, type SQL } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import {
  authorizeWebsite,
  authorizeWorkspace,
  WorkspaceError,
  WorkspacePersistenceError,
} from "../workspaces/service";
import type { UserId, WorkspaceId } from "../workspaces/contract";
import {
  installationSchema,
  websiteSettingsSchema,
  type Website,
  type TrackingScriptConfig,
} from "./contract";

type Actor = { db: Database; userId: UserId; workspaceId: WorkspaceId };

function websites({ db, query }: { db: Database; query: SQL }) {
  return Effect.tryPromise({
    try: async () => websiteSettingsSchema.array().parse((await db.execute(query)).rows),
    catch: (cause) => {
      const wrapped = z.object({ cause: z.unknown() }).safeParse(cause);
      const duplicate = z
        .object({
          code: z.literal("23505"),
          constraint: z.literal("website_workspace_hostname_idx"),
        })
        .safeParse(wrapped.success ? wrapped.data.cause : cause);
      return duplicate.success
        ? new WorkspaceError({
            code: "CONFLICT",
            message: "This hostname already exists in this Workspace",
          })
        : new WorkspacePersistenceError({ cause });
    },
  });
}

export function listWebsites(actor: Actor) {
  return Effect.gen(function* () {
    yield* authorizeWorkspace(actor);
    return yield* websites({
      db: actor.db,
      query: sql`
      SELECT id, workspace_id AS "workspaceId", name, hostname, public_tracking_id AS "publicTrackingId"
      FROM website WHERE workspace_id = ${actor.workspaceId} ORDER BY name, id
    `,
    });
  });
}

export function getWebsite(actor: Actor & { websiteId: Website["id"] }) {
  return Effect.gen(function* () {
    yield* authorizeWebsite({ ...actor, permission: "view" });
    const [found] = yield* websites({
      db: actor.db,
      query: sql`
      SELECT id, workspace_id AS "workspaceId", name, hostname, public_tracking_id AS "publicTrackingId"
      FROM website WHERE id = ${actor.websiteId} AND workspace_id = ${actor.workspaceId}
    `,
    });
    if (!found)
      return yield* new WorkspaceError({ code: "NOT_FOUND", message: "Website not found" });
    return found;
  });
}

export function createWebsite(actor: Actor & Pick<Website, "name" | "hostname">) {
  return Effect.gen(function* () {
    const current = yield* authorizeWorkspace(actor);
    if (current.role === "viewer")
      return yield* new WorkspaceError({
        code: "FORBIDDEN",
        message: "Website management permission required",
      });
    const [created] = yield* websites({
      db: actor.db,
      query: sql`
      WITH locked AS (
        UPDATE workspace SET revision = revision + 1
        WHERE id = ${actor.workspaceId} AND revision = ${current.revision} RETURNING id
      )
      INSERT INTO website (id, workspace_id, name, hostname, public_tracking_id)
      SELECT ${crypto.randomUUID()}, id, ${actor.name}, ${actor.hostname}, ${crypto.randomUUID()} FROM locked
      RETURNING id, workspace_id AS "workspaceId", name, hostname, public_tracking_id AS "publicTrackingId"
    `,
    });
    if (!created)
      return yield* new WorkspaceError({
        code: "CONFLICT",
        message: "Workspace changed. Refresh and try again.",
      });
    return created;
  });
}

export function updateWebsite(
  actor: Actor & { websiteId: Website["id"] } & Pick<Website, "name" | "hostname">,
) {
  return Effect.gen(function* () {
    yield* authorizeWebsite({ ...actor, permission: "configure" });
    const current = yield* authorizeWorkspace(actor);
    if (current.role === "viewer")
      return yield* new WorkspaceError({
        code: "FORBIDDEN",
        message: "Website management permission required",
      });
    const [updated] = yield* websites({
      db: actor.db,
      query: sql`
      WITH locked AS (
        UPDATE workspace SET revision = revision + 1
        WHERE id = ${actor.workspaceId} AND revision = ${current.revision} RETURNING id
      )
      UPDATE website s SET name = ${actor.name}, hostname = ${actor.hostname} FROM locked
      WHERE s.workspace_id = locked.id AND s.id = ${actor.websiteId}
      RETURNING s.id, s.workspace_id AS "workspaceId", s.name, s.hostname, s.public_tracking_id AS "publicTrackingId"
    `,
    });
    if (!updated)
      return yield* new WorkspaceError({
        code: "CONFLICT",
        message: "Workspace changed. Refresh and try again.",
      });
    return updated;
  });
}

export function websiteInstallation(
  actor: Actor & { websiteId: Website["id"]; trackingScript: TrackingScriptConfig },
) {
  return Effect.gen(function* () {
    const website = yield* getWebsite(actor);
    const configuredUrl = actor.trackingScript.url;
    const scriptUrl = configuredUrl
      ? yield* Effect.try({
          try: () => {
            const url = new URL(configuredUrl);
            const localHttp =
              actor.trackingScript.allowLocalHttp &&
              url.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
            if ((url.protocol !== "https:" && !localHttp) || url.username || url.password)
              throw new Error("Invalid tracking script URL configuration");
            return url.href;
          },
          catch: (cause) => new WorkspacePersistenceError({ cause }),
        })
      : null;
    const escaped = (scriptUrl ?? "YOUR_SCRIPT_URL")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const fields = {
      publicTrackingId: website.publicTrackingId,
      snippet: `<script defer src="${escaped}" data-tracking-id="${website.publicTrackingId}"></script>`,
    };
    return installationSchema.parse(
      scriptUrl
        ? { kind: "configured", scriptUrl, ...fields }
        : { kind: "unconfigured", ...fields },
    );
  });
}
