import { z } from "zod";
export const clipSettingsSchema = z.object({
	narrationStartMs: z.number().int().min(0).max(11_999).default(0),
	narrationVolume: z.number().min(0).max(2).default(1),
	videoVolume: z.number().min(0).max(2).default(0),
});
export const clipPreviewInput = z.object({
	projectId: z.uuid(),
	canvasId: z.uuid().optional(),
	nodeId: z.uuid(),
});
export const clipStartInput = clipPreviewInput.extend({
	id: z.uuid(),
	inputHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const clipProjectInput = z.object({
	projectId: z.uuid(),
	canvasId: z.uuid().optional(),
});
export const clipActive = (status: string) =>
	["queued", "rendering", "saving"].includes(status);
