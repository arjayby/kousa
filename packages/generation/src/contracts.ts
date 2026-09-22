import type { ResolvedInputs } from "@kousa/db/schema/generation-inputs";
import { z } from "zod";

export { resolveSpeechModel } from "./model-catalog";

import { fishVoices, modelsFor, standardImageSizes } from "./model-catalog";

export const textModels = modelsFor("text");
export const imageModels = modelsFor("image");
export const speechModels = modelsFor("speech");
export const videoModels = modelsFor("video");
export const defaultTextModel = "amazon/nova-micro";
export const defaultImageModel = "bfl/flux-2-klein-4b";
export const defaultSpeechModel = "fish-audio/s2.1-pro";
export const defaultVideoModel = "bytedance/seedance-v1.0-pro-fast";
export function resolveTextModel(modelId: string | undefined): string {
	return !modelId ||
		modelId === "openai/gpt-4.1-mini" ||
		modelId === "google/gemini-2.5-flash-lite"
		? defaultTextModel
		: modelId;
}
// Legacy exports describe the existing defaults. New quotations use modelCreditCost.
export const textCreditCost = 1;
export const imageCreditCost = 3;
export const speechCreditCost = 2;
export const videoCreditCost = (duration: number) => duration * 2;
export const imageSizes = standardImageSizes;
export const speechVoices = fishVoices;
export const defaultSpeechVoice = fishVoices[0].id;
export const maxSpeechCharacters = 1_000;
export const videoAspectRatios = ["1:1", "16:9", "9:16", "4:3"] as const;
export const videoDurations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const maxInputBytes = 12_000;
export const maxOutputTokens = 2_048;
export const generationProjectInput = z.object({
	projectId: z.uuid(),
	canvasId: z.uuid().optional(),
});
export const listGenerationsInput = generationProjectInput.extend({
	nodeIds: z.array(z.uuid()).max(200).optional(),
	selections: z
		.array(z.object({ nodeId: z.uuid(), runId: z.uuid() }))
		.max(200)
		.optional(),
});
export const generateInput = generationProjectInput.extend({
	id: z.uuid(),
	nodeId: z.uuid(),
	inputHash: z.string().regex(/^[a-f0-9]{64}$/),
	inputImageAssetId: z.uuid().optional(),
});

export type PublicRun = {
	resolvedInputs?: ResolvedInputs | null;
	id: string;
	nodeId: string;
	userId: string;
	modelId: string;
	kind: "text" | "image" | "speech" | "video";
	transcript: string | null;
	voiceId: string | null;
	assetId: string | null;
	inputImageAssetId?: string | null;
	status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
	cancelRequestedAt?: string | null;
	stage: "queued" | "generating" | "saving";
	output: string | null;
	error: string | null;
	credits: number;
	createdAt: string;
	inputHash: string;
};

export function isRunActive(run: { status: PublicRun["status"] } | undefined) {
	return run?.status === "queued" || run?.status === "running";
}
export function runProgress(
	run: Pick<PublicRun, "status" | "stage" | "cancelRequestedAt"> | undefined,
) {
	if (run?.status === "cancelled") return "Cancelled";
	if (run?.status === "running" && run.cancelRequestedAt)
		return "Finishing submitted request…";
	if (run?.status === "queued") return "Queued";
	if (run?.status === "running")
		return run.stage === "saving" ? "Saving result…" : "Generating…";
	return null;
}

export const generationHistoryInput = generationProjectInput.extend({
	nodeId: z.uuid(),
	cursor: z
		.object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
		.optional(),
	limit: z.number().int().min(1).max(50).default(10),
});
export const generationHistoryActionInput = generationProjectInput.extend({
	nodeId: z.uuid(),
	runId: z.uuid(),
	action: z.enum(["select", "restore"]),
});
