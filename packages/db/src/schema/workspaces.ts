import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  integer,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const workspace = pgTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The migration makes this FK DEFERRABLE INITIALLY DEFERRED so creation can
    // insert the Workspace and its initial Membership in one atomic statement.
    foreignKey({
      name: "workspace_owner_membership_fk",
      columns: [table.id, table.ownerUserId],
      foreignColumns: [membership.workspaceId, membership.userId],
    }),
  ],
);

export const membership = pgTable(
  "membership",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references((): AnyPgColumn => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Owner is derived from Workspace.ownerUserId, so two Owner roles cannot exist.
    role: text("role", { enum: ["admin", "viewer"] }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("membership_user_idx").on(table.userId),
    check("membership_role_check", sql`${table.role} IN ('admin', 'viewer')`),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "viewer"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status", { enum: ["pending", "accepted", "revoked"] })
      .notNull()
      .default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invitation_workspace_idx").on(table.workspaceId),
    uniqueIndex("invitation_pending_email_idx")
      .on(table.workspaceId, table.email)
      .where(sql`${table.status} = 'pending'`),
    check("invitation_role_check", sql`${table.role} IN ('admin', 'viewer')`),
    check("invitation_status_check", sql`${table.status} IN ('pending', 'accepted', 'revoked')`),
    check("invitation_email_check", sql`${table.email} = lower(${table.email})`),
  ],
);

export const website = pgTable(
  "website",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hostname: text("hostname").notNull(),
    publicTrackingId: text("public_tracking_id").notNull().unique(),
  },
  (table) => [
    index("website_workspace_idx").on(table.workspaceId),
    uniqueIndex("website_workspace_hostname_idx").on(table.workspaceId, table.hostname),
  ],
);
