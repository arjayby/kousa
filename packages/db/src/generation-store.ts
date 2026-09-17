import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { creditGrant } from "./schema/credits";
import { generationRun } from "./schema/generations";

type Database = Pick<
	PgDatabase<PgQueryResultHKT>,
	"select" | "selectDistinctOn" | "update"
>;
export type GenerationRun = typeof generationRun.$inferSelect;
type Claim = {
	claimed: boolean;
	error?: "FORBIDDEN" | "CONFLICT" | "NO_CREDITS" | "BUSY";
};
export const availableCredits = (userId: string) =>
	sql<number>`(
	select coalesce(sum(credits), 0) from ${creditGrant} where user_id = ${userId}
) - (
	select coalesce(sum(credits), 0) from ${generationRun} where user_id = ${userId}
	and (status = 'succeeded' or (status in ('queued', 'running') and expires_at > now()))
)`.mapWith(Number);

export function createGenerationStore(db: Database) {
	return {
		async get(id: string) {
			const [run] = await db
				.select()
				.from(generationRun)
				.where(eq(generationRun.id, id));
			return run ?? null;
		},
		async claim(
			input: Pick<
				GenerationRun,
				| "id"
				| "userId"
				| "projectId"
				| "nodeId"
				| "modelId"
				| "prompt"
				| "inputHash"
				| "credits"
			> & { kind?: GenerationRun["kind"]; size?: string | null },
		) {
			// This Postgres function locks the payer and project before checking balance
			// and reserving. It is one transaction even over Neon's HTTP driver.
			const [row] = await db
				.select({
					claim: sql<Claim>`kousa_claim_generation(
				${input.id}::uuid, ${input.userId}, ${input.projectId}::uuid, ${input.nodeId}::uuid,
				${input.modelId}, ${input.prompt}, ${input.inputHash}, ${input.credits}::integer, ${input.kind ?? "text"}, ${input.size ?? null}
			)`,
				})
				.from(sql`(select 1) as request`);
			if (!row) throw new Error("Generation reservation unavailable");
			return row.claim;
		},
		async expire(projectId?: string) {
			await db
				.update(generationRun)
				.set({
					status: "failed",
					error: "The run timed out. Your credit was released.",
					completedAt: new Date(),
				})
				.where(
					and(
						projectId ? eq(generationRun.projectId, projectId) : undefined,
						inArray(generationRun.status, ["queued", "running"]),
						sql`${generationRun.expiresAt} <= now()`,
					),
				);
		},
		async start(id: string) {
			const [result] = await db
				.select({ started: sql<boolean>`kousa_start_generation(${id}::uuid)` })
				.from(sql`(select 1) as request`);
			return result?.started ?? false;
		},
		async markSaving(id: string) {
			await db
				.update(generationRun)
				.set({ stage: "saving" })
				.where(
					and(
						eq(generationRun.id, id),
						eq(generationRun.status, "running"),
						sql`${generationRun.expiresAt} > now()`,
					),
				);
		},
		async pending() {
			return db
				.select({ id: generationRun.id })
				.from(generationRun)
				.where(
					and(
						inArray(generationRun.status, ["queued", "running"]),
						sql`${generationRun.expiresAt} > now()`,
					),
				)
				.orderBy(generationRun.createdAt)
				.limit(100);
		},
		async latest(projectId: string, nodeIds?: string[]) {
			if (nodeIds?.length === 0) return [];
			return db
				.selectDistinctOn([generationRun.nodeId])
				.from(generationRun)
				.where(
					and(
						eq(generationRun.projectId, projectId),
						nodeIds ? inArray(generationRun.nodeId, nodeIds) : undefined,
					),
				)
				.orderBy(
					generationRun.nodeId,
					desc(generationRun.createdAt),
					desc(generationRun.id),
				)
				.limit(200);
		},
		async outputs(
			projectId: string,
			nodeIds?: string[],
			kind: GenerationRun["kind"] = "text",
		) {
			if (nodeIds?.length === 0) return [];
			return db
				.selectDistinctOn([generationRun.nodeId])
				.from(generationRun)
				.where(
					and(
						eq(generationRun.projectId, projectId),
						nodeIds ? inArray(generationRun.nodeId, nodeIds) : undefined,
						eq(generationRun.kind, kind),
						eq(generationRun.status, "succeeded"),
					),
				)
				.orderBy(
					generationRun.nodeId,
					desc(generationRun.createdAt),
					desc(generationRun.id),
				);
		},
		async finishImage(id: string, assetId: string) {
			const [result] = await db
				.select({
					finished: sql<boolean>`kousa_finish_image_generation(${id}::uuid, ${assetId}::uuid)`,
				})
				.from(sql`(select 1) as request`);
			if (!result?.finished) return null;
			const [run] = await db
				.select()
				.from(generationRun)
				.where(eq(generationRun.id, id));
			return run ?? null;
		},
		async finish(
			id: string,
			result:
				| {
						output: string;
						inputTokens: number | null;
						outputTokens: number | null;
				  }
				| { error: string },
		) {
			if (!("error" in result)) {
				const [finished] = await db
					.select({
						ok: sql<boolean>`kousa_finish_generation(${id}::uuid, ${result.output}, NULL, ${result.inputTokens}::integer, ${result.outputTokens}::integer)`,
					})
					.from(sql`(select 1) as request`);
				if (!finished?.ok) return null;
				const [run] = await db
					.select()
					.from(generationRun)
					.where(eq(generationRun.id, id));
				return run ?? null;
			}
			const [run] = await db
				.update(generationRun)
				.set({
					...result,
					status: "failed",
					completedAt: new Date(),
				})
				.where(
					and(
						eq(generationRun.id, id),
						inArray(generationRun.status, ["queued", "running"]),
						sql`${generationRun.expiresAt} > now()`,
					),
				)
				.returning();
			return run ?? null;
		},
		async balance(userId: string) {
			const [row] = await db
				.select({ balance: availableCredits(userId) })
				.from(sql`(select 1) as request`);
			return row?.balance ?? 0;
		},
	};
}
export type GenerationStore = ReturnType<typeof createGenerationStore>;
