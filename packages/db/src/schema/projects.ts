import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const projectMemberRole = pgEnum("project_member_role", [
	"editor",
	"viewer",
]);

// Ownership is stored once, independently of removable collaborator memberships.
export const project = pgTable(
	"project",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		name: text("name").notNull(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("project_owner_id_idx").on(table.ownerId),
		check(
			"project_name_length",
			sql`char_length(btrim(${table.name})) between 1 and 120`,
		),
	],
);

export const projectMember = pgTable(
	"project_member",
	{
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: projectMemberRole("role").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.projectId, table.userId] }),
		index("project_member_user_id_idx").on(table.userId),
	],
);

export const projectInvite = pgTable(
	"project_invite",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull().unique(),
		role: projectMemberRole("role").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		acceptedAt: timestamp("accepted_at", { withTimezone: true }),
		acceptedBy: text("accepted_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => [index("project_invite_project_id_idx").on(table.projectId)],
);
