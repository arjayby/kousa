import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { canvasChat } from "./schema/canvas-chat";

type Database = Pick<PgDatabase<PgQueryResultHKT>, "select" | "update">;
export type CanvasChatRow = typeof canvasChat.$inferSelect;
export function createCanvasChatStore(db: Database) {
	return {
		async get(id: string) {
			const [row] = await db
				.select()
				.from(canvasChat)
				.where(eq(canvasChat.id, id));
			return row ?? null;
		},
		async history(userId: string, canvasId: string) {
			return db
				.select()
				.from(canvasChat)
				.where(
					and(eq(canvasChat.userId, userId), eq(canvasChat.canvasId, canvasId)),
				)
				.orderBy(desc(canvasChat.createdAt), desc(canvasChat.id))
				.limit(30);
		},
		async expire(userId: string) {
			await db
				.update(canvasChat)
				.set({
					status: "failed",
					error: "The reply timed out. Please send your request again.",
				})
				.where(
					and(
						eq(canvasChat.userId, userId),
						eq(canvasChat.status, "running"),
						sql`${canvasChat.expiresAt} <= now()`,
					),
				);
		},
		async claim(
			input: Pick<
				CanvasChatRow,
				"id" | "userId" | "projectId" | "canvasId" | "message" | "previousId"
			>,
		) {
			const [result] = await db
				.select({
					result: sql<{
						claimed: boolean;
						error?: "FORBIDDEN" | "CONFLICT" | "BUSY" | "LIMIT";
					}>`kousa_claim_canvas_chat(${input.id}::uuid, ${input.userId}, ${input.projectId}::uuid, ${input.canvasId}::uuid, ${input.message}, ${input.previousId}::uuid)`,
				})
				.from(sql`(select 1) as request`);
			if (!result) throw new Error("Could not save your request.");
			return result.result;
		},
		async finish(
			id: string,
			result: { proposal: unknown } | { error: string },
		) {
			await db
				.update(canvasChat)
				.set(
					"proposal" in result
						? { status: "succeeded", proposal: result.proposal }
						: { status: "failed", error: result.error },
				)
				.where(
					and(
						eq(canvasChat.id, id),
						eq(canvasChat.status, "running"),
						sql`${canvasChat.expiresAt} > now()`,
					),
				);
		},
	};
}
export type CanvasChatStore = ReturnType<typeof createCanvasChatStore>;
