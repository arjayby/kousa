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
import { mediaAsset } from "./media";
import { project } from "./projects";

// Server-owned runs form the debit ledger: queued/running reserve, succeeded spends,
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
		kind: text("kind", { enum: ["text", "image"] })
			.notNull()
			.default("text"),
		assetId: uuid("asset_id").references(() => mediaAsset.id, {
			onDelete: "restrict",
		}),
		prompt: text("prompt").notNull(),
		size: text("size"),
		stage: text("stage", { enum: ["queued", "generating", "saving"] })
			.notNull()
			.default("generating"),
		providerStartedAt: timestamp("provider_started_at", { withTimezone: true }),
		inputHash: text("input_hash").notNull(),
		status: text("status", {
			enum: ["queued", "running", "succeeded", "failed"],
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
		index("generation_pending_idx")
			.on(t.expiresAt)
			.where(sql`${t.status} in ('queued', 'running')`),
		check(
			"generation_stage_valid",
			sql`${t.stage} in ('queued', 'generating', 'saving')`,
		),
		uniqueIndex("generation_active_node_uidx")
			.on(t.projectId, t.nodeId)
			.where(sql`${t.status} in ('queued', 'running')`),
		uniqueIndex("generation_active_user_uidx")
			.on(t.userId)
			.where(sql`${t.status} in ('queued', 'running')`),
		check(
			"generation_status_valid",
			sql`${t.status} in ('queued', 'running', 'succeeded', 'failed')`,
		),
		check("generation_credits_positive", sql`${t.credits} > 0`),
		check("generation_kind_valid", sql`${t.kind} in ('text', 'image')`),
		check(
			"generation_result_valid",
			sql`(${t.status} = 'succeeded' and ${t.completedAt} is not null and ((${t.kind} = 'text' and ${t.output} is not null and length(${t.output}) > 0 and ${t.assetId} is null) or (${t.kind} = 'image' and ${t.output} is null and ${t.assetId} is not null))) or (${t.status} <> 'succeeded' and ${t.output} is null and ${t.assetId} is null)`,
		),
	],
);
