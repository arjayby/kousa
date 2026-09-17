import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { project } from "./projects";

// Server-owned runs also form the debit ledger: running reserves, succeeded spends,
// failed releases. No client-written canvas field can create or finalize a charge.
export const generationRun = pgTable(
	"generation_run",
	{
		id: uuid("id").primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		nodeId: uuid("node_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		modelId: text("model_id").notNull(),
		prompt: text("prompt").notNull(),
		inputHash: text("input_hash").notNull(),
		status: text("status", {
			enum: ["running", "succeeded", "failed"],
		}).notNull(),
		credits: integer("credits").notNull(),
		output: text("output"),
		error: text("error"),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(t) => [
		index("generation_project_node_idx").on(t.projectId, t.nodeId, t.createdAt),
		index("generation_user_idx").on(t.userId),
		uniqueIndex("generation_active_node_uidx")
			.on(t.projectId, t.nodeId)
			.where(sql`${t.status} = 'running'`),
		uniqueIndex("generation_active_user_uidx")
			.on(t.userId)
			.where(sql`${t.status} = 'running'`),
		check(
			"generation_status_valid",
			sql`${t.status} in ('running', 'succeeded', 'failed')`,
		),
		check("generation_credits_positive", sql`${t.credits} > 0`),
		check(
			"generation_result_valid",
			sql`(${t.status} = 'succeeded' and length(${t.output}) > 0 and ${t.completedAt} is not null) or (${t.status} <> 'succeeded' and ${t.output} is null)`,
		),
	],
);
