import { aspectRatios, type CanvasNode } from "@kousa/projects/canvas";
import modelData from "./model-data.json";
import videoData from "./video-capabilities.json";

export type ModelKind = "text" | "image" | "video" | "speech";
export type AspectRatio = (typeof aspectRatios)[number];
export type ImageQuality = "low" | "medium" | "high";
export const catalogCheckedAt = "2026-09-22";
const providerNames: Record<string, string> = {
	amazon: "Amazon",
	openai: "OpenAI",
	spacexai: "xAI",
	deepseek: "DeepSeek",
	meta: "Meta",
	anthropic: "Anthropic",
	mistral: "Mistral",
	alibaba: "Alibaba",
	google: "Google",
	bfl: "Black Forest Labs",
	prodia: "Black Forest Labs / Prodia",
	bytedance: "ByteDance",
	quiverai: "Quiver",
	recraft: "Recraft",
	minimax: "MiniMax",
	klingai: "Kuaishou",
	"fish-audio": "Fish Audio",
};
export type CatalogModel = {
	id: string;
	name: string;
	kind: ModelKind;
	provider: string;
	providerName: string;
	pricing: Record<string, unknown>;
	unavailableReason?: string;
};
// Reviewed Melius matches and existing Kousa models, never the entire live catalog.
export const modelCatalog: CatalogModel[] = modelData.map((model) => ({
	...model,
	kind: model.kind as ModelKind,
	providerName: providerNames[model.provider] ?? model.provider,
	...(model.id === "google/gemini-omni-flash-preview"
		? {
				unavailableReason:
					"Gateway lists video output, but its video request contract is not yet verified.",
			}
		: {}),
}));
export const modelsFor = (kind: ModelKind) =>
	modelCatalog.filter((model) => model.kind === kind);
export const findModel = (id: string, kind?: ModelKind) =>
	modelCatalog.find(
		(model) => model.id === id && (!kind || model.kind === kind),
	);
export function modelUnavailable(id: string, kind: ModelKind) {
	const model = findModel(id, kind);
	return model
		? (model.unavailableReason ?? null)
		: "Choose an available model.";
}

export const standardImageSizes = {
	"1:1": "1024x1024",
	"16:9": "1024x576",
	"9:16": "576x1024",
	"4:3": "1024x768",
} as const;
const openAIImageSizes = {
	"1:1": "1024x1024",
	"16:9": "1536x864",
	"9:16": "864x1536",
	"4:3": "1024x768",
} as const;
const recraftSizes = {
	"1:1": "1024x1024",
	"16:9": "1344x768",
	"9:16": "768x1344",
	"4:3": "1216x896",
} as const;
const recraftProSizes = {
	"1:1": "2048x2048",
	"16:9": "2688x1536",
	"9:16": "1536x2688",
	"4:3": "2432x1792",
} as const;
const largeImageSizes = {
	"1:1": "2048x2048",
	"16:9": "2560x1440",
	"9:16": "1440x2560",
	"4:3": "2304x1728",
} as const;
export function imageProfile(id: string) {
	const provider = findModel(id, "image")?.provider;
	const language = provider === "google";
	const vector = provider === "quiverai";
	return {
		language,
		vector,
		automaticSize: vector || provider === "meta",
		// The application exports Arrow's SVG as PNG for storage and downstream models.
		aspectRatios:
			vector || provider === "meta" || id === "openai/gpt-image-2"
				? (["1:1"] as const)
				: aspectRatios,
		sizes:
			provider === "bytedance"
				? largeImageSizes
				: provider === "openai"
					? openAIImageSizes
					: id === "recraft/recraft-v4.1-pro"
						? recraftProSizes
						: provider === "recraft"
							? recraftSizes
							: standardImageSizes,
		qualityOptions:
			provider === "openai" ? (["low", "medium", "high"] as const) : [],
		reference:
			language ||
			vector ||
			provider === "openai" ||
			provider === "bytedance" ||
			provider === "meta" ||
			id.startsWith("bfl/flux-2-") ||
			provider === "spacexai",
	};
}
export function imageSizeFor(id: string, ratio: AspectRatio) {
	return imageProfile(id).sizes[ratio];
}
export function imageQualityFor(
	id: string,
	quality?: ImageQuality,
): ImageQuality | undefined {
	return imageProfile(id).qualityOptions.length
		? (quality ?? "medium")
		: undefined;
}

type VideoCapabilities = {
	supported_operations: string[];
	supported_resolutions: string[];
	supported_aspect_ratios: string[];
	supported_durations_seconds: number[];
};
const videoCapabilities: Record<string, VideoCapabilities> = videoData;
export function videoProfile(id: string) {
	const caps = videoCapabilities[id];
	const operations = caps?.supported_operations ?? [];
	const resolution =
		id === "minimax/minimax-h3"
			? "768p"
			: (caps?.supported_resolutions[0] ?? "720p");
	return {
		aspectRatios: aspectRatios.filter((ratio) =>
			caps?.supported_aspect_ratios.includes(ratio),
		),
		// Media storage and clip composition currently accept videos up to 12 seconds.
		durations: (caps?.supported_durations_seconds ?? []).filter(
			(duration) => duration <= 12,
		),
		resolution,
		resolutionLabel: id.startsWith("klingai/") ? "Pro mode" : resolution,
		imageDeterminesRatio:
			id.startsWith("minimax/") ||
			(id.startsWith("klingai/") && id.endsWith("-i2v")),
		reference: operations.some(
			(operation) =>
				operation === "image-to-video" || operation === "reference-to-video",
		),
		requiresImage: !operations.includes("text-to-video"),
		referenceOnly:
			!operations.includes("image-to-video") &&
			operations.includes("reference-to-video"),
	};
}
export const fishVoices = [
	{ id: "933563129e564b19a115bedd57b7406a", name: "Sarah" },
	{ id: "f48d143a59a946ab87c0130fd081f349", name: "Polo" },
	{ id: "b347db033a6549378b48d00acb0d06cd", name: "Selene" },
	{ id: "bf322df2096a46f18c579d0baa36f41d", name: "Adrian" },
	{ id: "536d3a5e000945adb7038665781a4aca", name: "Ethan" },
] as const;
export const grokVoices = [
	{ id: "eve", name: "Eve" },
	{ id: "ara", name: "Ara" },
	{ id: "rex", name: "Rex" },
	{ id: "sal", name: "Sal" },
	{ id: "leo", name: "Leo" },
] as const;
export function resolveSpeechModel(id?: string) {
	return !id || id === "fish-audio/s2.1-pro-free" ? "fish-audio/s2.1-pro" : id;
}
export function voicesFor(id: string) {
	return id === "spacexai/grok-tts" ? grokVoices : fishVoices;
}
export function defaultVoiceFor(id: string) {
	return voicesFor(id)[0].id;
}

// Published Kousa credit tiers, not a promise of a provider's final USD charge.
// Text reserves for the 12 KB input / 2,048 output token caps. Existing defaults
// retain their prices. Media tiers cover the bounded settings exposed below.
const imageCredits: Record<string, number> = {
	"bfl/flux-2-klein-4b": 3,
	"bfl/flux-2-max": 16,
	"bfl/flux-pro-1.1-ultra": 12,
	"google/gemini-3.1-flash-image": 16,
	"google/gemini-3.1-flash-lite-image": 8,
	"google/gemini-3-pro-image": 32,
	"quiverai/arrow-1.1": 40,
	"meta/muse-image-1.0": 3,
	"prodia/flux-fast-schnell": 3,
	"bytedance/seedream-4.5": 8,
	"bytedance/seedream-5.0-lite": 7,
	"bytedance/seedream-5.0-pro": 8,
	"recraft/recraft-v4.1": 7,
	"recraft/recraft-v4.1-pro": 42,
	"spacexai/grok-imagine-image": 4,
	"spacexai/grok-imagine-image-2.0": 12,
};
const videoCreditsPerSecond: Record<string, number> = {
	"bytedance/seedance-v1.0-pro-fast": 2,
	"bfl/flux-3-video": 20,
	"minimax/minimax-h3": 20,
	"minimax/minimax-h3-max": 16,
	"google/veo-3.1-generate-001": 80,
	"google/veo-3.1-fast-generate-001": 30,
	"bytedance/seedance-2.0": 50,
	"bytedance/seedance-2.0-fast": 40,
	"bytedance/seedance-2.0-mini": 25,
	"bytedance/seedance-2.5": 75,
	"klingai/kling-v3.0-t2v": 64,
	"klingai/kling-v3.0-i2v": 64,
	"klingai/kling-v2.5-turbo-t2v": 14,
	"klingai/kling-v2.5-turbo-i2v": 14,
	"alibaba/wan-v3.0-video": 12,
	"alibaba/wan-v2.7-t2v": 20,
	"alibaba/wan-v2.7-r2v": 20,
	"spacexai/grok-imagine-video": 12,
	"spacexai/grok-imagine-video-1.5": 18,
};
export function modelCreditCost(
	kind: ModelKind,
	id: string,
	duration = 5,
	quality?: ImageQuality,
) {
	const model = findModel(id, kind);
	if (!model || model.unavailableReason) return 0;
	if (kind === "speech") return 2;
	if (kind === "video")
		return Math.ceil((videoCreditsPerSecond[id] ?? 0) * duration);
	if (kind === "image")
		return model.provider === "openai"
			? { low: 20, medium: 40, high: 80 }[quality ?? "medium"]
			: (imageCredits[id] ?? 0);
	const input = Number(model.pricing.input);
	const output = Number(model.pricing.output);
	return Math.max(1, Math.ceil((input * 12_000 + output * 2_048) * 200));
}

export function modelSettingsPatch(
	kind: ModelKind,
	id: string,
	data: Partial<CanvasNode["data"]>,
): Partial<CanvasNode["data"]> {
	if (kind === "speech")
		return {
			speechModel: id,
			voiceId: defaultVoiceFor(id),
			voiceDirection: "",
		};
	if (kind === "video") {
		const profile = videoProfile(id);
		return {
			videoModel: id,
			aspectRatio:
				data.aspectRatio && profile.aspectRatios.includes(data.aspectRatio)
					? data.aspectRatio
					: (profile.aspectRatios[0] ?? "16:9"),
			duration:
				data.duration && profile.durations.includes(data.duration)
					? data.duration
					: profile.durations.includes(5)
						? 5
						: (profile.durations[0] ?? 5),
		};
	}
	if (kind === "image")
		return {
			imageModel: id,
			imageQuality: imageQualityFor(id, data.imageQuality),
			aspectRatio: imageProfile(id).aspectRatios.some(
				(ratio) => ratio === data.aspectRatio,
			)
				? data.aspectRatio
				: "1:1",
		};
	return { textModel: id };
}

export function validateModelSettings(
	settings: {
		kind: ModelKind;
		modelId: string;
		duration?: number;
		aspectRatio?: string;
		voiceId?: string;
		voiceDirection?: string;
		imageQuality?: ImageQuality;
	},
	hasImage = false,
): string | null {
	const unavailable = modelUnavailable(settings.modelId, settings.kind);
	if (unavailable) return unavailable;
	if (
		settings.kind === "speech" &&
		!voicesFor(settings.modelId).some((voice) => voice.id === settings.voiceId)
	)
		return "Choose a voice supported by this model.";
	if (
		settings.kind === "speech" &&
		settings.modelId === "spacexai/grok-tts" &&
		settings.voiceDirection?.trim()
	)
		return "Grok TTS uses delivery tags in the script. Clear the separate voice direction.";
	if (settings.kind === "video") {
		const profile = videoProfile(settings.modelId);
		if (
			!profile.durations.includes(settings.duration ?? 0) ||
			!profile.aspectRatios.some((ratio) => ratio === settings.aspectRatio)
		)
			return "Choose a duration and aspect ratio supported by this model.";
		if (profile.requiresImage && !hasImage)
			return "Connect an Image node before using this model.";
		if (!profile.reference && hasImage)
			return "This model accepts text only. Choose its image-to-video variant or disconnect the image.";
	}
	if (
		settings.kind === "image" &&
		settings.aspectRatio &&
		!imageProfile(settings.modelId).aspectRatios.some(
			(ratio) => ratio === settings.aspectRatio,
		)
	)
		return "Choose an aspect ratio supported by this model.";
	if (
		settings.kind === "image" &&
		hasImage &&
		!imageProfile(settings.modelId).reference
	)
		return "This model does not support reference images. Choose an image editing model or disconnect the reference.";
	return null;
}
