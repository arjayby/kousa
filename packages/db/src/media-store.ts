import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import { mediaAsset } from "./schema/media";

type Database = Pick<
	PgDatabase<PgQueryResultHKT>,
	"select" | "update" | "execute"
>;
export type MediaAsset = typeof mediaAsset.$inferSelect;
export function createMediaStore(db: Database) {
	return {
		async reserve(
			input: Omit<
				typeof mediaAsset.$inferInsert,
				"id" | "status" | "createdAt"
			> & { uploaderId: string },
		) {
			const result = await db.execute(sql`select reserve_media_asset(
				${input.projectId}::uuid, ${input.uploaderId}, ${input.sha256}, ${input.name},
				${input.mimeType}, ${input.bytes}, ${input.width}, ${input.height}
			) as id`);
			const id = z
				.object({ rows: z.array(z.object({ id: z.string() })) })
				.parse(result).rows[0]?.id;
			if (!id || id === "forbidden") return "forbidden" as const;
			if (id === "full") return "full" as const;
			const [asset] = await db
				.select()
				.from(mediaAsset)
				.where(eq(mediaAsset.id, id));
			if (!asset) throw new Error("Reserved asset missing");
			return asset;
		},
		async complete(actorId: string, id: string) {
			const [asset] = await db
				.update(mediaAsset)
				.set({ status: "ready" })
				.where(
					and(
						eq(mediaAsset.id, id),
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
		list(projectId: string) {
			return db
				.select()
				.from(mediaAsset)
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
