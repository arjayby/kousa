import { and, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import { generationRun } from "./schema/generations";
import { mediaAsset } from "./schema/media";

type Database = Pick<
	PgDatabase<PgQueryResultHKT>,
	"select" | "selectDistinctOn" | "update" | "execute"
>;
export type MediaAsset = typeof mediaAsset.$inferSelect;
export function createMediaStore(db: Database) {
	return {
		async reserve(
			input: Omit<
				typeof mediaAsset.$inferInsert,
				"id" | "status" | "createdAt"
			> & { uploaderId: string; writeId?: string },
		) {
			const result = await db.execute(
				input.projectId == null
					? sql`select reserve_personal_media(${input.uploaderId}, ${input.sha256}, ${input.name}, ${input.mimeType}, ${input.bytes}::integer, ${input.width ?? null}::integer, ${input.height ?? null}::integer, ${input.durationMs ?? null}::integer) as id`
					: sql`select reserve_media_asset_lifecycle(
				${input.projectId}::uuid, ${input.uploaderId}, ${input.sha256}, ${input.name},
				${input.mimeType}, ${input.bytes}, ${input.width ?? null}, ${input.height ?? null}, ${input.durationMs ?? null},
				${input.retentionReason === undefined ? "generation" : input.retentionReason}, ${input.writeId ?? null}::uuid
			) as id`,
			);
			const id = z
				.object({ rows: z.array(z.object({ id: z.string() })) })
				.parse(result).rows[0]?.id;
			if (!id || id === "forbidden") return "forbidden" as const;
			if (id === "full") return "full" as const;
			if (id === "deleting") return "deleting" as const;
			const [asset] = await db
				.select()
				.from(mediaAsset)
				.where(eq(mediaAsset.id, id));
			if (!asset) throw new Error("Reserved asset missing");
			return asset;
		},
		async finishWrite(id: string) {
			await db.execute(
				sql`delete from media_upload_write where id=${id}::uuid`,
			);
		},
		async complete(actorId: string, id: string) {
			const [asset] = await db
				.update(mediaAsset)
				.set({ status: "ready", uploadedAt: sql`now()` })
				.where(
					and(
						eq(mediaAsset.id, id),
						sql`${mediaAsset.status} in ('pending','ready')`,
						sql`exists (select 1 from project p where p.id = ${mediaAsset.projectId} and
				(p.owner_id = ${actorId} or exists (select 1 from project_member m where m.project_id = p.id and m.user_id = ${actorId} and m.role = 'editor')))`,
					),
				)
				.returning();
			return asset ?? null;
		},
		async get(projectId: string, id: string) {
			const [asset] = await db
				.select()
				.from(mediaAsset)
				.where(
					and(
						eq(mediaAsset.projectId, projectId),
						eq(mediaAsset.id, id),
						eq(mediaAsset.status, "ready"),
					),
				);
			return asset ?? null;
		},
		async getPersonal(actorId: string, id: string) {
			const [asset] = await db
				.select()
				.from(mediaAsset)
				.where(
					and(
						isNull(mediaAsset.projectId),
						eq(mediaAsset.ownerId, actorId),
						eq(mediaAsset.id, id),
						eq(mediaAsset.status, "ready"),
					),
				);
			return asset ?? null;
		},
		list(projectId: string) {
			// Preserve the spoken script even after its canvas node is deleted.
			// Deduplicated audio can have multiple runs; return one entry per asset.
			const speech = db
				.selectDistinctOn([generationRun.assetId], {
					assetId: generationRun.assetId,
					transcript: generationRun.prompt,
				})
				.from(generationRun)
				.where(
					and(
						eq(generationRun.projectId, projectId),
						eq(generationRun.kind, "speech"),
						eq(generationRun.status, "succeeded"),
					),
				)
				.orderBy(
					generationRun.assetId,
					desc(generationRun.completedAt),
					desc(generationRun.id),
				)
				.as("speech");
			return db
				.select({
					...getTableColumns(mediaAsset),
					transcript: sql<
						string | null
					>`coalesce(${speech.transcript}, (select c.plan->>'transcript' from clip_run c where c.asset_id = ${mediaAsset.id} and c.project_id = ${mediaAsset.projectId} and c.status = 'succeeded' order by c.completed_at desc limit 1))`,
				})
				.from(mediaAsset)
				.leftJoin(speech, eq(speech.assetId, mediaAsset.id))
				.where(
					and(
						eq(mediaAsset.projectId, projectId),
						eq(mediaAsset.status, "ready"),
					),
				)
				.orderBy(desc(mediaAsset.createdAt), desc(mediaAsset.id));
		},
	};
}
export type MediaStore = ReturnType<typeof createMediaStore>;
