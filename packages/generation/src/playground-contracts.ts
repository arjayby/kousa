import { z } from "zod";
import {
	imageCreditCost,
	imageModels,
	maxInputBytes,
	maxSpeechCharacters,
	speechCreditCost,
	speechModels,
	speechVoices,
	textCreditCost,
	textModels,
	videoCreditCost,
	videoModels,
} from "./contracts";
import { authoredSettingsSchema } from "./history";

export const playgroundModels = {
	text: textModels,
	image: imageModels,
	video: videoModels,
	speech: speechModels,
};
export const playgroundSettings = authoredSettingsSchema.superRefine(
	(settings, ctx) => {
		if (!settings.content.trim())
			ctx.addIssue({
				code: "custom",
				path: ["content"],
				message: "Write a prompt before generating.",
			});
		if (new TextEncoder().encode(settings.content).length > maxInputBytes)
			ctx.addIssue({
				code: "custom",
				path: ["content"],
				message: "Shorten your prompt to 12 KB or less.",
			});
		if (
			!playgroundModels[settings.kind].some(
				(model) => model.id === settings.modelId,
			)
		)
			ctx.addIssue({
				code: "custom",
				path: ["modelId"],
				message: "Choose an available model.",
			});
		if (settings.kind === "speech") {
			if (settings.content.length > maxSpeechCharacters)
				ctx.addIssue({
					code: "custom",
					path: ["content"],
					message: "Keep your script to 1,000 characters or fewer.",
				});
			if (!speechVoices.some((voice) => voice.id === settings.voiceId))
				ctx.addIssue({
					code: "custom",
					path: ["voiceId"],
					message: "Choose an available voice.",
				});
		}
	},
);
export const playgroundGenerateInput = z.object({
	id: z.uuid(),
	settings: playgroundSettings,
});
export const playgroundHistoryInput = z.object({
	limit: z.number().int().min(1).max(30).default(12),
	cursor: z
		.object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
		.optional(),
});
export const playgroundImportInput = z.object({
	runId: z.uuid(),
	projectId: z.uuid(),
	canvasId: z.uuid(),
});
export function playgroundCost(
	settings: z.infer<typeof authoredSettingsSchema>,
) {
	return settings.kind === "video"
		? videoCreditCost(settings.duration)
		: {
				text: textCreditCost,
				image: imageCreditCost,
				speech: speechCreditCost,
			}[settings.kind];
}
export function playgroundMediaUrl(assetId: string) {
	return `/api/playground/media/${encodeURIComponent(assetId)}`;
}
