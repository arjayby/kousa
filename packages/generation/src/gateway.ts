import { createGateway, generateImage, generateText } from "ai";
import { maxOutputTokens } from "./contracts";
import type { ImageProvider, TextProvider } from "./providers";

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
