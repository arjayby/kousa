import { createGateway, generateImage, generateSpeech, generateText } from "ai";
import { maxOutputTokens } from "./contracts";
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
): ImageProvider {
	return {
		configured: Boolean(apiKey?.trim()),
		async generate({ modelId, prompt, size }) {
			const result = await generateImage({
				model: createGateway({ apiKey }).imageModel(modelId),
				prompt,
				size,
				n: 1,
				maxRetries: 0,
				abortSignal: AbortSignal.timeout(90_000),
			});
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
			// Fish S2 uses natural-language bracket cues, not the SDK's instructions field.
			// Keep the immutable spoken script separate for the saved transcript.
			const cue = voiceDirection.replace(/[[\]\r\n]/g, " ").trim();
			const result = await generateSpeech({
				model: createGateway({ apiKey }).speechModel(modelId),
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
