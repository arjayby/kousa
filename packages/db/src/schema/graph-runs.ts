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
import { project } from "./projects";

// Immutable server-built execution plan. Dependencies refer to steps in this plan,
// never to whichever output happens to be latest when the worker wakes up.
type GraphStepBase = {
	runId: string;
	nodeId: string;
	label: string;
	modelId: string;
	content: string;
	sources: { id: string; content: string }[];
	size: string | null;
	inputHash: string;
	credits: number;
	reused: boolean;
};
export type GraphStep = GraphStepBase &
	(
		| { kind: "text" | "image" }
		| {
				kind: "video";
				duration: number;
				aspectRatio: "1:1" | "16:9" | "9:16" | "4:3";
				image: {
					nodeId: string;
					imageSource: "generated" | "project";
					assetId?: string | null;
				} | null;
				inputImageOrigin?: string | null;
		  }
	);

export const graphRun = pgTable(
	"graph_run",
	{
		id: uuid("id").primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		nodeId: uuid("node_id").notNull(),
		inputHash: text("input_hash").notNull(),
		plan: jsonb("plan").$type<GraphStep[]>().notNull(),
		resumeOf: uuid("resume_of"),
		status: text("status", { enum: ["running", "succeeded", "failed"] })
			.notNull()
			.default("running"),
		remainingCredits: integer("remaining_credits").notNull(),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(t) => [
		index("graph_run_project_idx").on(t.projectId, t.createdAt),
		uniqueIndex("graph_run_active_user_uidx")
			.on(t.userId)
			.where(sql`${t.status} = 'running'`),
		uniqueIndex("graph_run_active_project_uidx")
			.on(t.projectId)
			.where(sql`${t.status} = 'running'`),
		uniqueIndex("graph_run_resume_uidx").on(t.resumeOf),
		check(
			"graph_run_status_valid",
			sql`${t.status} in ('running', 'succeeded', 'failed')`,
		),
		check(
			"graph_run_reservation_valid",
			sql`${t.remainingCredits} >= 0 and (${t.status} = 'running' or ${t.remainingCredits} = 0)`,
		),
		check(
			"graph_run_plan_valid",
			sql`jsonb_typeof(${t.plan}) = 'array' and jsonb_array_length(${t.plan}) between 1 and 20`,
		),
	],
);
