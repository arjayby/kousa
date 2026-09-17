import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
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
			>,
		) {
			const [result] = await db
				.select({
					claim: sql<Claim>`kousa_claim_graph(${input.id}::uuid, ${input.userId}, ${input.projectId}::uuid, ${input.nodeId}::uuid, ${input.inputHash}, ${JSON.stringify(input.plan)}::jsonb, ${input.resumeOf}::uuid)`,
				})
				.from(sql`(select 1) request`);
			if (!result) throw new Error("Workflow reservation unavailable");
			return result.claim;
		},
		async begin(id: string, index: number, prompt: string) {
			const [result] = await db
				.select({
					ok: sql<boolean>`kousa_begin_graph_step(${id}::uuid, ${index}::integer, ${prompt})`,
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
						sql`${graphRun.expiresAt} <= now()`,
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
		async list(projectId: string) {
			return db
				.select()
				.from(graphRun)
				.where(eq(graphRun.projectId, projectId))
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
