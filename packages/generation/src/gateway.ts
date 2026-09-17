import { createGateway, generateText } from "ai";
import { maxOutputTokens } from "./contracts";
import type { TextProvider } from "./service";

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
