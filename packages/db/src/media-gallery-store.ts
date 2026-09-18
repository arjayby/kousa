import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { mediaAsset } from "./schema/media";
import { project } from "./schema/projects";

type GalleryInput = {
	kind: "all" | "image" | "video" | "speech";
	search: string;
	limit: number;
	cursor?: { createdAt: string; id: string };
};

export function createMediaGalleryStore(
	db: Pick<PgDatabase<PgQueryResultHKT>, "select">,
) {
	return {
		list(actorId: string, input: GalleryInput) {
			const search = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
			return db
				.select({
					id: mediaAsset.id,
					name: mediaAsset.name,
					mimeType: mediaAsset.mimeType,
					bytes: mediaAsset.bytes,
					width: mediaAsset.width,
					height: mediaAsset.height,
					durationMs: mediaAsset.durationMs,
					projectId: mediaAsset.projectId,
					projectName: project.name,
					// Keep Postgres microseconds so pagination cannot skip nearby files.
					createdAt: sql<string>`to_char(${mediaAsset.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
					transcript: sql<string | null>`coalesce(
						(select g.prompt from generation_run g where g.asset_id = ${mediaAsset.id}
							and g.project_id is not distinct from ${mediaAsset.projectId}
							and (${mediaAsset.projectId} is not null or g.user_id = ${actorId})
							and g.kind = 'speech' and g.status = 'succeeded'
							order by g.completed_at desc, g.id desc limit 1),
						(select c.plan->>'transcript' from clip_run c where c.asset_id = ${mediaAsset.id}
							and c.project_id = ${mediaAsset.projectId} and c.status = 'succeeded'
							order by c.completed_at desc, c.id desc limit 1))`,
				})
				.from(mediaAsset)
				.leftJoin(project, eq(project.id, mediaAsset.projectId))
				.where(
					and(
						eq(mediaAsset.status, "ready"),
						or(
							and(
								isNull(mediaAsset.projectId),
								eq(mediaAsset.ownerId, actorId),
							),
							eq(project.ownerId, actorId),
							sql`exists (select 1 from project_member m where m.project_id = ${mediaAsset.projectId} and m.user_id = ${actorId})`,
						),
						// A retained upload is not necessarily a generated output. Use the
						// completed ledgers as provenance, including workflow and clip outputs.
						sql`(exists (select 1 from generation_run g where g.asset_id = ${mediaAsset.id}
							and g.project_id is not distinct from ${mediaAsset.projectId}
							and (${mediaAsset.projectId} is not null or g.user_id = ${actorId})
							and g.status = 'succeeded')
							or exists (select 1 from clip_run c where c.asset_id = ${mediaAsset.id}
								and c.project_id = ${mediaAsset.projectId} and c.status = 'succeeded'))`,
						input.kind === "image"
							? ilike(mediaAsset.mimeType, "image/%")
							: input.kind === "video"
								? eq(mediaAsset.mimeType, "video/mp4")
								: input.kind === "speech"
									? eq(mediaAsset.mimeType, "audio/mpeg")
									: undefined,
						input.search
							? or(ilike(mediaAsset.name, search), ilike(project.name, search))
							: undefined,
						input.cursor
							? sql`(${mediaAsset.createdAt}, ${mediaAsset.id}) < (${input.cursor.createdAt}::timestamptz, ${input.cursor.id}::uuid)`
							: undefined,
					),
				)
				.orderBy(desc(mediaAsset.createdAt), desc(mediaAsset.id))
				.limit(input.limit + 1);
		},
	};
}

export type MediaGalleryStore = ReturnType<typeof createMediaGalleryStore>;
