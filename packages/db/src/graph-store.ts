import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { user } from "./schema/auth";
import type { ResolvedInputs } from "./schema/generation-inputs";
import { generationRun } from "./schema/generations";
import { graphRun } from "./schema/graph-runs";

export type GraphRun = typeof graphRun.$inferSelect;
type Database = Pick<PgDatabase<PgQueryResultHKT>, "select">;
type Claim = {
	claimed: boolean;
	error?: "FORBIDDEN" | "CONFLICT" | "BUSY" | "NO_CREDITS";
};

export function createGraphStore(db: Database) {
	async function finish(id: string, error: string | null = null) {
		const [result] = await db
			.select({ ok: sql<boolean>`kousa_finish_graph(${id}::uuid, ${error})` })
			.from(sql`(select 1) request`);
		return result?.ok ?? false;
	}
	return {
		async cancel(id: string, projectId: string, actorId: string) {
			const [result] = await db
				.select({
					result: sql<string>`kousa_cancel_graph(${id}::uuid, ${projectId}::uuid, ${actorId})`,
				})
				.from(sql`(select 1) request`);
			return result?.result;
		},
		async history(
			projectId: string,
			limit: number,
			cursor?: { createdAt: string; id: string },
			canvasId = projectId,
		) {
			return db
				.select({
					run: graphRun,
					userName: user.name,
					cursorTime: sql<string>`to_char(${graphRun.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
					resumed: sql<boolean>`exists(select 1 from graph_run next where next.resume_of = ${graphRun.id})`,
				})
				.from(graphRun)
				.innerJoin(user, eq(user.id, graphRun.userId))
				.where(
					and(
						eq(graphRun.projectId, projectId),
						eq(graphRun.canvasId, canvasId),
						cursor
							? sql`(${graphRun.createdAt}, ${graphRun.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
							: undefined,
					),
				)
				.orderBy(desc(graphRun.createdAt), desc(graphRun.id))
				.limit(limit + 1);
		},
		async hasResume(id: string) {
			const rows = await db
				.select({ id: graphRun.id })
				.from(graphRun)
				.where(eq(graphRun.resumeOf, id))
				.limit(1);
			return rows.length > 0;
		},
		async get(id: string) {
			const [run] = await db.select().from(graphRun).where(eq(graphRun.id, id));
			return run ?? null;
		},
		async claim(
			input: Pick<
				GraphRun,
				| "id"
				| "userId"
				| "projectId"
				| "nodeId"
				| "inputHash"
				| "plan"
				| "resumeOf"
			> & { canvasId?: string },
		) {
			const [result] = await db
				.select({
					claim: sql<Claim>`kousa_claim_graph(${input.id}::uuid, ${input.userId}, ${input.projectId}::uuid, ${input.nodeId}::uuid, ${input.inputHash}, ${JSON.stringify(input.plan)}::jsonb, ${input.resumeOf}::uuid, ${input.canvasId ?? input.projectId}::uuid)`,
				})
				.from(sql`(select 1) request`);
			if (!result) throw new Error("Workflow reservation unavailable");
			return result.claim;
		},
		async begin(
			id: string,
			index: number,
			prompt: string,
			inputs?: ResolvedInputs,
		) {
			const [result] = await db
				.select({
					ok: sql<boolean>`kousa_begin_graph_step(${id}::uuid, ${index}::integer, ${prompt}, ${JSON.stringify(inputs ?? null)}::jsonb)`,
				})
				.from(sql`(select 1) request`);
			return result?.ok ?? false;
		},
		finish,
		async expire(projectId?: string) {
			const expired = await db
				.select({ id: graphRun.id })
				.from(graphRun)
				.where(
					and(
						projectId ? eq(graphRun.projectId, projectId) : undefined,
						eq(graphRun.status, "running"),
						sql`(${graphRun.expiresAt} <= now() or (${graphRun.cancelRequestedAt} is not null and not exists (
							select 1 from generation_run child where child.graph_run_id = ${graphRun.id} and child.status in ('queued', 'running')
						)))`,
					),
				)
				.limit(100);
			for (const run of expired)
				await finish(
					run.id,
					"The workflow timed out. Resume to continue unfinished steps.",
				);
		},
		async pending() {
			return db
				.select({ id: graphRun.id })
				.from(graphRun)
				.where(
					and(
						eq(graphRun.status, "running"),
						sql`${graphRun.expiresAt} > now()`,
					),
				)
				.orderBy(graphRun.createdAt)
				.limit(100);
		},
		async list(projectId: string, canvasId = projectId) {
			return db
				.select()
				.from(graphRun)
				.where(
					and(
						eq(graphRun.projectId, projectId),
						eq(graphRun.canvasId, canvasId),
					),
				)
				.orderBy(desc(graphRun.createdAt), desc(graphRun.id))
				.limit(20);
		},
		async results(ids: string[]) {
			if (!ids.length) return [];
			return db
				.select()
				.from(generationRun)
				.where(inArray(generationRun.id, ids));
		},
	};
}
export type GraphStore = ReturnType<typeof createGraphStore>;
