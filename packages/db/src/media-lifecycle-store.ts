import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";

const asset = z.object({
	id: z.string(),
	projectId: z.string(),
	mimeType: z.string(),
	bytes: z.number(),
	status: z.string(),
	retentionReason: z.string().nullable(),
	uploadedAt: z.coerce.date().nullable(),
	writes: z.coerce.number(),
});
const reference = z.object({
	assetId: z.string(),
	id: z.string(),
	nodeId: z.string(),
	kind: z.enum(["generation", "workflow", "clip"]),
	status: z.string(),
});
const rows = <T>(result: unknown, schema: z.ZodType<T>) =>
	z.object({ rows: z.array(schema) }).parse(result).rows;
export function createMediaLifecycleStore(
	db: Pick<PgDatabase<PgQueryResultHKT>, "execute">,
) {
	return {
		async assets(projectId: string) {
			return rows(
				await db.execute(
					sql`select a.id, a.project_id as "projectId", a.mime_type as "mimeType", a.bytes, a.status, a.retention_reason as "retentionReason", a.uploaded_at as "uploadedAt", (select count(*) from media_upload_write w where w.asset_id=a.id) as writes from media_asset a where a.project_id=${projectId}::uuid and a.status <> 'deleted' order by a.created_at`,
				),
				asset,
			);
		},
		async references(projectId: string) {
			return rows(
				await db.execute(sql`
    select a.id as "assetId", r.id, r.node_id as "nodeId", 'generation' as kind, r.status from media_asset a join generation_run r on r.project_id=a.project_id and position('"'||a.id::text||'"' in to_jsonb(r)::text)>0 where a.project_id=${projectId}::uuid and a.status <> 'deleted'
    union all select a.id, r.id, r.node_id, 'workflow', r.status from media_asset a join graph_run r on r.project_id=a.project_id and position('"'||a.id::text||'"' in r.plan::text)>0 where a.project_id=${projectId}::uuid and a.status <> 'deleted'
    union all select a.id, r.id, r.node_id, 'clip', r.status from media_asset a join clip_run r on r.project_id=a.project_id and position('"'||a.id::text||'"' in to_jsonb(r)::text)>0 where a.project_id=${projectId}::uuid and a.status <> 'deleted'`),
				reference,
			);
		},
		async canvas(projectId: string) {
			return rows(
				await db.execute(
					sql`select canvas, canvas_room_id as room from project where id=${projectId}::uuid`,
				),
				z.object({ canvas: z.unknown(), room: z.string().nullable() }),
			)[0];
		},
		async retain(actorId: string, projectId: string, assetId: string) {
			return (
				rows(
					await db.execute(
						sql`select retain_media_asset(${projectId}::uuid,${actorId},${assetId}::uuid) as ok`,
					),
					z.object({ ok: z.boolean() }),
				)[0]?.ok ?? false
			);
		},
		async protectLegacyList(projectId: string) {
			// Legacy browsers attach synchronously. Pin before returning any candidate IDs.
			await db.execute(
				sql`update media_asset set retention_reason='legacy' where project_id=${projectId}::uuid and status='ready' and retention_reason is null`,
			);
		},
		async protectObserved(projectId: string, assetId: string) {
			await db.execute(
				sql`update media_asset set retention_reason=coalesce(retention_reason,'canvas') where project_id=${projectId}::uuid and id=${assetId}::uuid and status='ready'`,
			);
		},
		async claim(
			projectId: string,
			assetId: string,
			actorId: string | null,
			abandoned = false,
		) {
			return rows(
				await db.execute(
					sql`select claim_media_removal(${projectId}::uuid,${assetId}::uuid,${actorId},${abandoned}) as result`,
				),
				z.object({ result: z.string() }),
			)[0]?.result;
		},
		async deleted(assetId: string) {
			await db.execute(
				sql`update media_asset set status='deleted' where id=${assetId}::uuid and status='deleting'`,
			);
		},
		async candidates(limit = 25) {
			return rows(
				await db.execute(
					sql`select distinct project_id as "projectId" from media_asset where status='deleting' or (status='ready' and retention_reason is null and uploaded_at < now()-interval '7 days' and not exists(select 1 from media_upload_write where asset_id=media_asset.id)) limit ${limit}`,
				),
				z.object({ projectId: z.string() }),
			);
		},
	};
}
export type MediaLifecycleStore = ReturnType<typeof createMediaLifecycleStore>;
