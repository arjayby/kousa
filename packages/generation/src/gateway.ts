import { createGateway, generateImage, generateSpeech, generateText } from "ai";
import { maxOutputTokens } from "./contracts";
import { imageProfile, resolveSpeechModel } from "./model-catalog";
import type { ImageProvider, SpeechProvider, TextProvider } from "./providers";

export function createGatewayProvider(
	apiKey: string | undefined,
): TextProvider {
	return {
		configured: Boolean(apiKey?.trim()),
		async generate({ modelId, prompt }) {
			const gateway = createGateway({ apiKey });
			const result = await generateText({
				model: gateway(modelId),
				prompt,
				maxOutputTokens,
				maxRetries: 0,
				abortSignal: AbortSignal.timeout(60_000),
			});
			return {
				output: result.text,
				inputTokens: result.usage.inputTokens ?? null,
				outputTokens: result.usage.outputTokens ?? null,
			};
		},
	};
}

export function createGatewayImageProvider(
	apiKey: string | undefined,
	rasterizeSvg?: (
		bytes: Uint8Array<ArrayBuffer>,
	) => Promise<Uint8Array<ArrayBuffer>>,
): ImageProvider {
	return {
		configured: Boolean(apiKey?.trim()),
		async generate({ modelId, prompt, size, referenceImage, quality }) {
			const profile = imageProfile(modelId);
			if (referenceImage && !profile.reference)
				throw new Error("Unsupported image reference");
			const ratio = Object.entries(profile.sizes).find(
				([, value]) => value === size,
			)?.[0];
			if (!ratio || !profile.aspectRatios.some((value) => value === ratio))
				throw new Error("Unsupported image dimensions");
			const gateway = createGateway({ apiKey });
			if (profile.language) {
				const result = await generateText({
					model: gateway(modelId),
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: prompt },
								...(referenceImage
									? [{ type: "image" as const, image: referenceImage }]
									: []),
							],
						},
					],
					providerOptions: {
						google: {
							responseModalities: ["TEXT", "IMAGE"],
							imageConfig: { aspectRatio: ratio, imageSize: "1K" },
						},
					},
					maxRetries: 0,
					abortSignal: AbortSignal.timeout(120_000),
				});
				const file = result.files.find((file) =>
					["image/png", "image/jpeg", "image/webp"].includes(file.mediaType),
				);
				if (!file) throw new Error("The model did not return an image");
				return {
					bytes: new Uint8Array(file.uint8Array),
					mimeType: file.mediaType,
				};
			}
			const usesRatio =
				modelId === "bfl/flux-pro-1.1-ultra" || modelId.startsWith("spacexai/");
			const result = await generateImage({
				model: gateway.imageModel(modelId),
				prompt: referenceImage
					? { text: prompt, images: [referenceImage] }
					: prompt,
				...(profile.vector || modelId === "meta/muse-image-1.0"
					? {}
					: usesRatio
						? { aspectRatio: ratio as `${number}:${number}` }
						: { size }),
				...(modelId.startsWith("openai/")
					? {
							providerOptions: {
								openai: { quality: quality ?? "medium", outputFormat: "png" },
							},
						}
					: modelId.startsWith("bfl/flux-2-")
						? {
								providerOptions: {
									blackForestLabs: {
										width: Number(size.split("x")[0]),
										height: Number(size.split("x")[1]),
									},
								},
							}
						: {}),
				n: 1,
				maxRetries: 0,
				abortSignal: AbortSignal.timeout(90_000),
			});
			if (result.image.mediaType === "image/svg+xml") {
				if (!rasterizeSvg) throw new Error("SVG rendering is unavailable");
				return {
					bytes: await rasterizeSvg(new Uint8Array(result.image.uint8Array)),
					mimeType: "image/png",
				};
			}
			return {
				bytes: new Uint8Array(result.image.uint8Array),
				mimeType: result.image.mediaType,
			};
		},
	};
}

export function createGatewaySpeechProvider(
	apiKey: string | undefined,
): SpeechProvider {
	return {
		configured: Boolean(apiKey?.trim()),
		async generate({ modelId, text, voiceId, voiceDirection }) {
			const resolvedModel = resolveSpeechModel(modelId);
			// Fish S2 uses natural-language bracket cues, not the SDK's instructions field.
			// Keep the immutable spoken script separate for the saved transcript.
			const cue = resolvedModel.startsWith("fish-audio/")
				? voiceDirection.replace(/[[\]\r\n]/g, " ").trim()
				: "";
			const result = await generateSpeech({
				model: createGateway({ apiKey }).speechModel(resolvedModel),
				text: cue ? `[${cue}] ${text}` : text,
				voice: voiceId,
				outputFormat: "mp3",
				maxRetries: 0,
				abortSignal: AbortSignal.timeout(90_000),
			});
			return {
				bytes: new Uint8Array(result.audio.uint8Array),
				mimeType: result.audio.mediaType,
			};
		},
	};
}
