import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { project } from "./projects";

export const mediaAsset = pgTable(
	"media_asset",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		projectId: uuid("project_id").references(() => project.id, {
			onDelete: "restrict",
		}),
		ownerId: text("owner_id").references(() => user.id, {
			onDelete: "restrict",
		}),
		uploaderId: text("uploader_id").references(() => user.id, {
			onDelete: "set null",
		}),
		sha256: text("sha256").notNull(),
		name: text("name").notNull(),
		mimeType: text("mime_type").notNull(),
		bytes: integer("bytes").notNull(),
		width: integer("width"),
		height: integer("height"),
		durationMs: integer("duration_ms"),
		status: text("status").notNull().default("pending"),
		retentionReason: text("retention_reason").default("legacy"),
		uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
		deletionRequestedAt: timestamp("deletion_requested_at", {
			withTimezone: true,
		}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		check(
			"media_asset_scope",
			sql`(${table.projectId} is not null and ${table.ownerId} is null) or (${table.projectId} is null and ${table.ownerId} is not null)`,
		),
		uniqueIndex("media_asset_personal_hash_uidx")
			.on(table.ownerId, table.sha256)
			.where(sql`${table.projectId} is null and ${table.status} <> 'deleted'`),
		uniqueIndex("media_asset_project_hash_uidx")
			.on(table.projectId, table.sha256)
			.where(sql`${table.status} <> 'deleted'`),
		index("media_asset_project_status_idx").on(table.projectId, table.status),
		check(
			"media_asset_status",
			sql`${table.status} in ('pending', 'ready', 'deleting', 'deleted')`,
		),
		check(
			"media_asset_mime",
			sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'video/mp4')`,
		),
		check(
			"media_asset_bytes",
			sql`${table.bytes} between 1 and (case when ${table.mimeType} = 'video/mp4' then 20971520 else 10485760 end)`,
		),
		check(
			"media_asset_dimensions",
			sql`(${table.mimeType} in ('image/png', 'image/jpeg', 'image/webp') and ${table.width} is not null and ${table.height} is not null and ${table.width} > 0 and ${table.height} > 0 and ${table.width}::bigint * ${table.height} <= 40000000 and ${table.durationMs} is null) or (${table.mimeType} = 'audio/mpeg' and ${table.width} is null and ${table.height} is null and ${table.durationMs} is not null and ${table.durationMs} between 1 and 180000) or (${table.mimeType} = 'video/mp4' and ${table.width} is not null and ${table.height} is not null and ${table.width} between 1 and 1920 and ${table.height} between 1 and 1920 and ${table.durationMs} is not null and ${table.durationMs} between 1 and 12000)`,
		),
		check("media_asset_hash", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
	],
);

export const mediaUploadWrite = pgTable(
	"media_upload_write",
	{
		id: uuid("id").primaryKey(),
		assetId: uuid("asset_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("media_upload_write_asset_idx").on(table.assetId),
		foreignKey({
			name: "media_upload_write_asset_id_fkey",
			columns: [table.assetId],
			foreignColumns: [mediaAsset.id],
		}).onDelete("cascade"),
	],
);
