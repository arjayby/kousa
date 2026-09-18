import { z } from "zod";

export const maxVideoBytes = 20 * 1024 * 1024;
export const maxVideoDurationMs = 12_000;
export const maxAudioDurationMs = 180_000;
export const maxAudioBytes = 10 * 1024 * 1024;
export const maxImageBytes = 10 * 1024 * 1024;
export const imageMimeTypes = [
	"image/png",
	"image/jpeg",
	"image/webp",
] as const;
export const mediaParams = z.object({
	projectId: z.uuid(),
	assetId: z.uuid().optional(),
});
export const publicAssetSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	mimeType: z.enum([...imageMimeTypes, "audio/mpeg", "video/mp4"]),
	bytes: z.number(),
	width: z.number().nullable(),
	height: z.number().nullable(),
	durationMs: z.number().nullable(),
});
export type PublicAsset = z.infer<typeof publicAssetSchema>;
export const projectAssetSchema = publicAssetSchema.extend({
	transcript: z.string().nullable(),
});
export type ProjectAsset = z.infer<typeof projectAssetSchema>;
export const mediaListSchema = z.object({
	assets: z.array(projectAssetSchema),
});
export const mediaUploadSchema = z.object({ asset: publicAssetSchema });
export const mediaLifecycleSchema = z.object({
	storage: z.object({
		files: z.number(),
		bytes: z.number(),
		pendingFiles: z.number(),
		pendingBytes: z.number(),
		removingFiles: z.number(),
		maxFiles: z.number(),
		maxBytes: z.number(),
	}),
	graphAvailable: z.boolean(),
	usage: z.array(
		z.object({
			assetId: z.string(),
			references: z.array(
				z.object({
					kind: z.string(),
					label: z.string(),
					nodeId: z.string().optional(),
				}),
			),
			removable: z.boolean(),
			reason: z.string().nullable(),
			cleanupAt: z.string().nullable(),
		}),
	),
});
export const mediaLifecycleHeaders = { "X-Kousa-Media-Lifecycle": "1" };
export function mediaUrl(projectId: string, assetId?: string) {
	return `/api/projects/${encodeURIComponent(projectId)}/media${assetId ? `/${encodeURIComponent(assetId)}` : ""}`;
}
