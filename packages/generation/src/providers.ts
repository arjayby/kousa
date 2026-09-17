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

export type VideoStatus =
	| { status: "pending" }
	| { status: "failed" }
	| { status: "succeeded"; bytes: Uint8Array<ArrayBuffer>; mimeType: string };
export interface VideoProvider {
	configured: boolean;
	start(input: {
		id: string;
		modelId: string;
		prompt: string;
		imageUrl?: string;
		aspectRatio: `${number}:${number}`;
		duration: number;
	}): Promise<unknown>;
	poll(input: { modelId: string; operation: unknown }): Promise<VideoStatus>;
}
