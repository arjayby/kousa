import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
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
		// Null is reserved for historical, disabled invitations from before email targeting.
		email: text("email"),
		role: projectMemberRole("role").notNull(),
		expiresInDays: integer("expires_in_days").notNull().default(7),
		deliveryStatus: text("delivery_status").notNull().default("sending"),
		deliveryAttemptedAt: timestamp("delivery_attempted_at", {
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
		sentAt: timestamp("sent_at", { withTimezone: true }),
		deliveryError: text("delivery_error"),
		messageId: text("message_id"),
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
	(table) => [
		index("project_invite_project_id_idx").on(table.projectId),
		uniqueIndex("project_invite_project_email_uidx").on(
			table.projectId,
			table.email,
		),
		check(
			"project_invite_email_required",
			sql`${table.email} is not null or ${table.revokedAt} is not null or ${table.acceptedAt} is not null`,
		),
		check(
			"project_invite_email_normalized",
			sql`${table.email} = lower(btrim(${table.email}))`,
		),
		check(
			"project_invite_expiry_days",
			sql`${table.expiresInDays} in (1, 7, 30)`,
		),
		check(
			"project_invite_delivery_status",
			sql`${table.deliveryStatus} in ('sending', 'sent', 'failed')`,
		),
	],
);
