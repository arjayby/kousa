import { sql } from "drizzle-orm";
import {
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { project, projectCanvas } from "./projects";

export const canvasChat = pgTable(
	"canvas_chat",
	{
		id: uuid("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		canvasId: uuid("canvas_id")
			.notNull()
			.references(() => projectCanvas.id, { onDelete: "cascade" }),
		previousId: uuid("previous_id"),
		message: text("message").notNull(),
		status: text("status", {
			enum: ["running", "succeeded", "failed"],
		}).notNull(),
		proposal: jsonb("proposal"),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		index("canvas_chat_history_idx").on(
			table.userId,
			table.canvasId,
			table.createdAt,
			table.id,
		),
		index("canvas_chat_limit_idx").on(table.userId, table.createdAt),
		check(
			"canvas_chat_status_valid",
			sql`${table.status} in ('running', 'succeeded', 'failed')`,
		),
		check(
			"canvas_chat_result_valid",
			sql`(${table.status} = 'succeeded' and ${table.proposal} is not null) or (${table.status} <> 'succeeded' and ${table.proposal} is null)`,
		),
	],
);
