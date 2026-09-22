import { z } from "zod";
import {
	imageModels,
	maxInputBytes,
	maxSpeechCharacters,
	speechModels,
	textInputByteLimit,
	textModels,
	videoModels,
} from "./contracts";
import { authoredSettingsSchema } from "./history";
import {
	imageProfile,
	modelCreditCost,
	validateModelSettings,
} from "./model-catalog";

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
		const byteLimit =
			settings.kind === "text"
				? textInputByteLimit(settings.modelId)
				: maxInputBytes;
		if (new TextEncoder().encode(settings.content).length > byteLimit)
			ctx.addIssue({
				code: "custom",
				path: ["content"],
				message:
					byteLimit === maxInputBytes
						? "Shorten your prompt to 12 KB or less."
						: `Shorten your prompt to ${byteLimit.toLocaleString("en-US")} bytes or choose a model with a larger context.`,
			});
		const settingsError = validateModelSettings(settings);
		if (
			settings.modelId.startsWith("recraft/") &&
			settings.content.length >
				imageProfile(settings.modelId).promptMaxCharacters
		)
			ctx.addIssue({
				code: "custom",
				path: ["content"],
				message: `Recraft prompts must be ${imageProfile(settings.modelId).promptMaxCharacters.toLocaleString("en-US")} characters or fewer.`,
			});
		if (settingsError)
			ctx.addIssue({
				code: "custom",
				path: ["modelId"],
				message: settingsError,
			});
		if (settings.kind === "speech") {
			if (settings.content.length > maxSpeechCharacters)
				ctx.addIssue({
					code: "custom",
					path: ["content"],
					message: "Keep your script to 1,000 characters or fewer.",
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
	return modelCreditCost(
		settings.kind,
		settings.modelId,
		settings.kind === "video" ? settings.duration : undefined,
		settings.kind === "image" ? settings.imageQuality : undefined,
	);
}
export function playgroundMediaUrl(assetId: string) {
	return `/api/playground/media/${encodeURIComponent(assetId)}`;
}
