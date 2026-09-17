export interface TextProvider {
	configured: boolean;
	generate(input: { modelId: string; prompt: string }): Promise<{
		output: string;
		inputTokens: number | null;
		outputTokens: number | null;
	}>;
}
export interface ImageProvider {
	configured: boolean;
	generate(input: {
		modelId: string;
		prompt: string;
		size: `${number}x${number}`;
	}): Promise<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string }>;
}
