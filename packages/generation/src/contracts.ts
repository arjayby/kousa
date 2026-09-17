import { z } from "zod";

export const textModels = [
	// Verified against Vercel's Free Tier filter on 2026-09-17.
	// https://vercel.com/ai-gateway/models?freeTier=true&q=nova
	{ id: "amazon/nova-micro", name: "Amazon Nova Micro" },
	{ id: "amazon/nova-lite", name: "Amazon Nova Lite" },
] as const;
export const defaultTextModel = textModels[0].id;

// Existing canvases may still store a model from the initial paid-model picker.
// Resolve those selections consistently on the client and server without rewriting
// shared documents. Unknown IDs still reach the service's allowlist validation.
export function resolveTextModel(modelId: string | undefined): string {
	return !modelId ||
		modelId === "openai/gpt-4.1-mini" ||
		modelId === "google/gemini-2.5-flash-lite"
		? defaultTextModel
		: modelId;
}
export const textCreditCost = 1;
// Verified in Vercel's Free Tier image catalog on 2026-09-17.
export const imageModels = [
	{ id: "bfl/flux-2-klein-4b", name: "FLUX.2 [klein] 4B" },
] as const;
export const defaultImageModel = imageModels[0].id;
export const imageCreditCost = 3;
export const imageSizes = {
	"1:1": "1024x1024",
	"16:9": "1024x576",
	"9:16": "576x1024",
	"4:3": "1024x768",
} as const;
// Requires a Gateway account with paid credits enabled, even though the model
// currently has zero provider cost. https://vercel.com/ai-gateway/models/s2.1-pro-free
export const speechModels = [
	{ id: "fish-audio/s2.1-pro-free", name: "Fish Audio S2.1 Pro" },
] as const;
export const defaultSpeechModel = speechModels[0].id;
// Stock voices from the model's Gateway playground; no user voice cloning.
export const speechVoices = [
	{ id: "933563129e564b19a115bedd57b7406a", name: "Sarah" },
	{ id: "f48d143a59a946ab87c0130fd081f349", name: "Polo" },
	{ id: "b347db033a6549378b48d00acb0d06cd", name: "Selene" },
	{ id: "bf322df2096a46f18c579d0baa36f41d", name: "Adrian" },
	{ id: "536d3a5e000945adb7038665781a4aca", name: "Ethan" },
] as const;
export const defaultSpeechVoice = speechVoices[0].id;
export const speechCreditCost = 2;
export const maxSpeechCharacters = 1_000;
export const maxInputBytes = 12_000;
export const maxOutputTokens = 2_048;
export const generationProjectInput = z.object({ projectId: z.uuid() });
export const listGenerationsInput = generationProjectInput.extend({
	nodeIds: z.array(z.uuid()).max(200).optional(),
});
export const generateInput = generationProjectInput.extend({
	id: z.uuid(),
	nodeId: z.uuid(),
	inputHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type PublicRun = {
	id: string;
	nodeId: string;
	userId: string;
	modelId: string;
	kind: "text" | "image" | "speech";
	transcript: string | null;
	voiceId: string | null;
	assetId: string | null;
	status: "queued" | "running" | "succeeded" | "failed";
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
	run: Pick<PublicRun, "status" | "stage"> | undefined,
) {
	if (run?.status === "queued") return "Queued";
	if (run?.status === "running")
		return run.stage === "saving" ? "Saving result…" : "Generating…";
	return null;
}
