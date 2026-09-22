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
import type { ResolvedInputs } from "./generation-inputs";
import { graphRun } from "./graph-runs";
import { mediaAsset } from "./media";
import { project, projectCanvas } from "./projects";

// Server-owned runs form the debit ledger: queued/running reserve, succeeded spends,
// failed/cancelled releases. No client-written canvas field can create or finalize a charge.
export const generationRun = pgTable(
	"generation_run",
	{
		id: uuid("id").primaryKey(),
		graphRunId: uuid("graph_run_id").references(() => graphRun.id, {
			onDelete: "restrict",
		}),
		canvasId: uuid("canvas_id").references(() => projectCanvas.id, {
			onDelete: "restrict",
		}),
		projectId: uuid("project_id").references(() => project.id, {
			onDelete: "restrict",
		}),
		sourceRunId: uuid("source_run_id"),
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
		authoredSettings: jsonb("authored_settings"),
		resolvedInputs: jsonb("resolved_inputs").$type<ResolvedInputs>(),
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
			enum: ["queued", "running", "succeeded", "failed", "cancelled"],
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
		cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(t) => [
		check(
			"generation_scope",
			sql`(${t.projectId} is not null and ${t.canvasId} is not null) or (${t.projectId} is null and ${t.canvasId} is null and ${t.graphRunId} is null and ${t.sourceRunId} is null)`,
		),
		index("generation_personal_history_idx")
			.on(t.userId, t.createdAt, t.id)
			.where(sql`${t.projectId} is null`),
		uniqueIndex("generation_import_uidx")
			.on(t.sourceRunId, t.canvasId, t.userId)
			.where(sql`${t.sourceRunId} is not null`),
		index("generation_project_node_idx").on(t.projectId, t.nodeId, t.createdAt),
		index("generation_project_history_idx")
			.on(t.projectId, t.createdAt, t.id)
			.where(sql`${t.graphRunId} is null`),
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
			sql`${t.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
		),
		check(
			"generation_video_settings",
			sql`${t.kind} <> 'video' or (${t.duration} is not null and ${t.duration} between 1 and 12 and ${t.aspectRatio} is not null and ${t.aspectRatio} in ('1:1','16:9','9:16','4:3'))`,
		),
		check(
			"generation_credits_positive",
			sql`(${t.sourceRunId} is null and ${t.credits} > 0) or (${t.sourceRunId} is not null and ${t.credits} = 0 and ${t.status} = 'succeeded' and ${t.projectId} is not null)`,
		),
		check(
			"generation_input_image_valid",
			sql`(${t.inputImageAssetId} is null and ${t.inputImageOrigin} is null and ${t.inputImageTokenHash} is null) or (${t.kind} = 'image' and ${t.inputImageAssetId} is not null and ${t.inputImageOrigin} is null and ${t.inputImageTokenHash} is null) or (${t.kind} = 'video' and (${t.inputImageAssetId} is not null or jsonb_array_length(coalesce(${t.resolvedInputs}->'media', '[]'::jsonb)) > 0) and ${t.inputImageOrigin} is not null and (${t.inputImageTokenHash} is null or ${t.inputImageTokenHash} ~ '^[a-f0-9]{64}$'))`,
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
