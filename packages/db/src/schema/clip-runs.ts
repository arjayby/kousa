import { sql } from "drizzle-orm";
import {
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { mediaAsset } from "./media";
import { project, projectCanvas } from "./projects";

export type ClipPlan = {
	videoAssetId: string;
	audioAssetId: string;
	audioNodeId: string;
	label: string;
	durationMs: number;
	narrationStartMs: number;
	narrationVolume: number;
	videoVolume: number;
	transcript: string | null;
};
export const clipRun = pgTable(
	"clip_run",
	{
		id: uuid("id").primaryKey(),
		canvasId: uuid("canvas_id")
			.notNull()
			.references(() => projectCanvas.id, { onDelete: "restrict" }),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		nodeId: uuid("node_id").notNull(),
		inputHash: text("input_hash").notNull(),
		plan: jsonb("plan").$type<ClipPlan>().notNull(),
		status: text("status", {
			enum: ["queued", "rendering", "saving", "succeeded", "failed"],
		})
			.notNull()
			.default("queued"),
		assetId: uuid("asset_id").references(() => mediaAsset.id, {
			onDelete: "restrict",
		}),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(t) => [
		index("clip_run_project_idx").on(t.projectId, t.createdAt),
		uniqueIndex("clip_run_active_project_uidx")
			.on(t.projectId)
			.where(sql`${t.status} in ('queued', 'rendering', 'saving')`),
		uniqueIndex("clip_run_active_user_uidx")
			.on(t.userId)
			.where(sql`${t.status} in ('queued', 'rendering', 'saving')`),
		check(
			"clip_run_status_valid",
			sql`${t.status} in ('queued', 'rendering', 'saving', 'succeeded', 'failed')`,
		),
		check(
			"clip_run_result_valid",
			sql`(${t.status} = 'succeeded') = (${t.assetId} is not null)`,
		),
	],
);
