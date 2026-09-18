import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { clipRun } from "./schema/clip-runs";
export type ClipRun = typeof clipRun.$inferSelect;
type Database = Pick<
	PgDatabase<PgQueryResultHKT>,
	"select" | "update" | "selectDistinctOn"
>;
const active = ["queued", "rendering", "saving"] as const;
export function createClipStore(db: Database) {
	return {
		async get(id: string) {
			return (
				(await db.select().from(clipRun).where(eq(clipRun.id, id)))[0] ?? null
			);
		},
		async claim(
			input: Pick<
				ClipRun,
				"id" | "projectId" | "userId" | "nodeId" | "inputHash" | "plan"
			> & { canvasId?: string },
		) {
			const [result] = await db
				.select({
					result: sql<string>`kousa_claim_clip(${input.id}::uuid, ${input.userId}, ${input.projectId}::uuid, ${input.nodeId}::uuid, ${input.inputHash}, ${JSON.stringify(input.plan)}::jsonb, ${input.canvasId ?? input.projectId}::uuid)`,
				})
				.from(sql`(select 1) request`);
			if (!result) throw new Error("Clip storage unavailable");
			return result.result;
		},
		latest(projectId: string, succeeded = false, canvasId = projectId) {
			return db
				.selectDistinctOn([clipRun.nodeId])
				.from(clipRun)
				.where(
					and(
						eq(clipRun.projectId, projectId),
						eq(clipRun.canvasId, canvasId),
						succeeded ? eq(clipRun.status, "succeeded") : undefined,
					),
				)
				.orderBy(clipRun.nodeId, desc(clipRun.createdAt), desc(clipRun.id))
				.limit(200);
		},
		pending() {
			return db
				.select()
				.from(clipRun)
				.where(
					and(
						inArray(clipRun.status, [...active]),
						sql`${clipRun.expiresAt}>now()`,
					),
				)
				.limit(100);
		},
		async phase(id: string, status: "rendering" | "saving") {
			await db
				.update(clipRun)
				.set({ status })
				.where(and(eq(clipRun.id, id), inArray(clipRun.status, [...active])));
		},
		async fail(
			id: string,
			error = "Clip creation failed. Your original media is unchanged. Try creating the clip again.",
		) {
			await db
				.update(clipRun)
				.set({ status: "failed", error, completedAt: new Date() })
				.where(and(eq(clipRun.id, id), inArray(clipRun.status, [...active])));
		},
		async finish(id: string, assetId: string) {
			const [result] = await db
				.select({
					ok: sql<boolean>`kousa_finish_clip(${id}::uuid,${assetId}::uuid)`,
				})
				.from(sql`(select 1) request`);
			return result?.ok ?? false;
		},
		async expire() {
			await db
				.update(clipRun)
				.set({
					status: "failed",
					error: "Clip creation expired. Create the clip again.",
					completedAt: new Date(),
				})
				.where(
					and(
						inArray(clipRun.status, [...active]),
						sql`${clipRun.expiresAt} <= now()`,
					),
				);
		},
	};
}
export type ClipStore = ReturnType<typeof createClipStore>;
