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
export const mediaListSchema = z.object({ assets: z.array(publicAssetSchema) });
export const mediaUploadSchema = z.object({ asset: publicAssetSchema });
export function mediaUrl(projectId: string, assetId?: string) {
	return `/api/projects/${encodeURIComponent(projectId)}/media${assetId ? `/${encodeURIComponent(assetId)}` : ""}`;
}
