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

export interface SpeechProvider {
	configured: boolean;
	generate(input: {
		modelId: string;
		text: string;
		voiceId: string;
		voiceDirection: string;
	}): Promise<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string }>;
}
