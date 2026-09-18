import { z } from "zod";
import { publicAssetSchema } from "./contracts";

export const mediaGalleryInput = z.object({
	kind: z.enum(["all", "image", "video", "speech"]).default("all"),
	search: z.string().trim().max(200).default(""),
	limit: z.number().int().min(1).max(60).default(24),
	cursor: z.object({ createdAt: z.iso.datetime(), id: z.uuid() }).optional(),
});

export const galleryAssetSchema = publicAssetSchema.extend({
	projectId: z.uuid().nullable(),
	projectName: z.string().nullable(),
	createdAt: z.iso.datetime(),
	transcript: z.string().nullable(),
});

export type GalleryAsset = z.infer<typeof galleryAssetSchema>;
export type GalleryInput = z.input<typeof mediaGalleryInput>;
export type GalleryPage = {
	assets: GalleryAsset[];
	nextCursor: { createdAt: string; id: string } | null;
};
