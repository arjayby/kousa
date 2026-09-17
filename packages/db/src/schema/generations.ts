import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { graphRun } from "./graph-runs";
import { mediaAsset } from "./media";
import { project } from "./projects";

// Server-owned runs form the debit ledger: queued/running reserve, succeeded spends,
// failed releases. No client-written canvas field can create or finalize a charge.
export const generationRun = pgTable(
	"generation_run",
	{
		id: uuid("id").primaryKey(),
		graphRunId: uuid("graph_run_id").references(() => graphRun.id, {
			onDelete: "restrict",
		}),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		nodeId: uuid("node_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		modelId: text("model_id").notNull(),
		kind: text("kind", { enum: ["text", "image", "speech", "video"] })
			.notNull()
			.default("text"),
		assetId: uuid("asset_id").references(() => mediaAsset.id, {
			onDelete: "restrict",
		}),
		inputImageAssetId: uuid("input_image_asset_id").references(
			() => mediaAsset.id,
			{ onDelete: "restrict" },
		),
		inputImageOrigin: text("input_image_origin"),
		inputImageTokenHash: text("input_image_token_hash"),
		prompt: text("prompt").notNull(),
		size: text("size"),
		duration: integer("duration"),
		aspectRatio: text("aspect_ratio"),
		providerOperation: jsonb("provider_operation"),
		voiceId: text("voice_id"),
		voiceDirection: text("voice_direction"),
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
		check(
			"generation_video_settings",
			sql`${t.kind} <> 'video' or (${t.duration} is not null and ${t.duration} in (5,10) and ${t.aspectRatio} is not null and ${t.aspectRatio} in ('1:1','16:9','9:16','4:3'))`,
		),
		check("generation_credits_positive", sql`${t.credits} > 0`),
		check(
			"generation_input_image_valid",
			sql`(${t.inputImageAssetId} is null and ${t.inputImageOrigin} is null and ${t.inputImageTokenHash} is null) or (${t.kind} = 'video' and ${t.inputImageAssetId} is not null and ${t.inputImageOrigin} is not null and (${t.inputImageTokenHash} is null or ${t.inputImageTokenHash} ~ '^[a-f0-9]{64}$'))`,
		),
		check(
			"generation_kind_valid",
			sql`${t.kind} in ('text', 'image', 'speech', 'video')`,
		),
		check(
			"generation_result_valid",
			sql`(${t.status} = 'succeeded' and ${t.completedAt} is not null and ((${t.kind} = 'text' and ${t.output} is not null and length(${t.output}) > 0 and ${t.assetId} is null) or (${t.kind} in ('image', 'speech', 'video') and ${t.output} is null and ${t.assetId} is not null))) or (${t.status} <> 'succeeded' and ${t.output} is null and ${t.assetId} is null)`,
		),
	],
);
