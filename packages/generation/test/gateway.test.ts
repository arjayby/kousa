import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	generateImage: vi.fn(),
	generateSpeech: vi.fn(),
	speechModel: vi.fn(),
	imageModel: vi.fn(),
	model: vi.fn(),
	createGateway: vi.fn(),
}));
vi.mock("ai", () => ({
	generateText: mocks.generateText,
	generateImage: mocks.generateImage,
	generateSpeech: mocks.generateSpeech,
	createGateway: mocks.createGateway,
}));

import {
	createGatewayImageProvider,
	createGatewayProvider,
	createGatewaySpeechProvider,
} from "../src/gateway";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.model.mockReturnValue("gateway-model");
	mocks.createGateway.mockReturnValue(mocks.model);
	mocks.generateText.mockResolvedValue({
		text: "Result",
		usage: { inputTokens: 20, outputTokens: 5 },
	});
});
it("uses a server-supplied key, bounded output, a timeout and no automatic SDK retries", async () => {
	const provider = createGatewayProvider("test-key");
	expect(
		await provider.generate({ modelId: "amazon/nova-micro", prompt: "Test" }),
	).toEqual({ output: "Result", inputTokens: 20, outputTokens: 5 });
	expect(mocks.createGateway).toHaveBeenCalledWith({ apiKey: "test-key" });
	expect(mocks.model).toHaveBeenCalledWith("amazon/nova-micro");
	expect(mocks.generateText).toHaveBeenCalledWith(
		expect.objectContaining({
			model: "gateway-model",
			maxOutputTokens: 2048,
			maxRetries: 0,
			abortSignal: expect.any(AbortSignal),
		}),
	);
});
it("reports missing configuration without reading browser environment variables", () => {
	expect(createGatewayProvider("").configured).toBe(false);
	expect(createGatewayProvider(undefined).configured).toBe(false);
});

it("requests one bounded image and returns bytes without automatic retries", async () => {
	mocks.createGateway.mockReturnValue({ imageModel: mocks.imageModel });
	mocks.imageModel.mockReturnValue("image-model");
	const bytes = new Uint8Array([1, 2, 3]);
	mocks.generateImage.mockResolvedValue({
		image: { uint8Array: bytes, mediaType: "image/png" },
	});
	const result = await createGatewayImageProvider("test-key").generate({
		modelId: "bfl/flux-2-klein-4b",
		prompt: "A red balloon",
		size: "1024x576",
	});
	expect(result).toEqual({ bytes, mimeType: "image/png" });
	expect(mocks.imageModel).toHaveBeenCalledWith("bfl/flux-2-klein-4b");
	expect(mocks.generateImage).toHaveBeenCalledWith(
		expect.objectContaining({
			model: "image-model",
			prompt: "A red balloon",
			size: "1024x576",
			n: 1,
			maxRetries: 0,
			abortSignal: expect.any(AbortSignal),
		}),
	);
});

it("requests MP3 speech with a fixed voice, Fish delivery cue and no paid-call retry", async () => {
	mocks.createGateway.mockReturnValue({ speechModel: mocks.speechModel });
	mocks.speechModel.mockReturnValue("speech-model");
	const bytes = new Uint8Array([1, 2, 3]);
	mocks.generateSpeech.mockResolvedValue({
		audio: { uint8Array: bytes, mediaType: "audio/mpeg" },
	});
	expect(
		await createGatewaySpeechProvider("test-key").generate({
			modelId: "fish-audio/s2.1-pro-free",
			text: "Welcome",
			voiceId: "933563129e564b19a115bedd57b7406a",
			voiceDirection: "[warm]\ncalm",
		}),
	).toEqual({ bytes, mimeType: "audio/mpeg" });
	expect(mocks.speechModel).toHaveBeenCalledWith("fish-audio/s2.1-pro");
	expect(mocks.generateSpeech).toHaveBeenCalledWith(
		expect.objectContaining({
			model: "speech-model",
			text: "[warm  calm] Welcome",
			voice: "933563129e564b19a115bedd57b7406a",
			outputFormat: "mp3",
			maxRetries: 0,
			abortSignal: expect.any(AbortSignal),
		}),
	);
});

it("sends private reference bytes through the SDK image-edit prompt", async () => {
	mocks.createGateway.mockReturnValue({ imageModel: mocks.imageModel });
	mocks.imageModel.mockReturnValue("image-model");
	const bytes = new Uint8Array([1, 2, 3]);
	mocks.generateImage.mockResolvedValue({
		image: { uint8Array: bytes, mediaType: "image/png" },
	});
	await createGatewayImageProvider("test-key").generate({
		modelId: "bfl/flux-2-klein-4b",
		prompt: "Replace the background",
		size: "1024x1024",
		referenceImage: bytes,
	});
	expect(mocks.generateImage).toHaveBeenCalledWith(
		expect.objectContaining({
			prompt: { text: "Replace the background", images: [bytes] },
			n: 1,
			maxRetries: 0,
		}),
	);
});

it("uses the language image route for Nano Banana and reads an image file", async () => {
	const bytes = new Uint8Array([1, 2, 3]);
	mocks.generateText.mockResolvedValue({
		files: [{ mediaType: "image/png", uint8Array: bytes }],
	});
	expect(
		await createGatewayImageProvider("test-key").generate({
			modelId: "google/gemini-3.1-flash-image",
			prompt: "A balloon",
			size: "1024x576",
			referenceImage: bytes,
		}),
	).toEqual({ bytes, mimeType: "image/png" });
	expect(mocks.model).toHaveBeenCalledWith("google/gemini-3.1-flash-image");
	expect(mocks.generateText).toHaveBeenCalledWith(
		expect.objectContaining({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "A balloon" },
						{ type: "image", image: bytes },
					],
				},
			],
			providerOptions: {
				google: {
					responseModalities: ["TEXT", "IMAGE"],
					imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
				},
			},
			maxRetries: 0,
		}),
	);
	expect(mocks.generateImage).not.toHaveBeenCalled();
	mocks.generateText.mockResolvedValue({ files: [] });
	await expect(
		createGatewayImageProvider("key").generate({
			modelId: "google/gemini-3-pro-image",
			prompt: "x",
			size: "1024x1024",
		}),
	).rejects.toThrow("did not return an image");
});

it("rasterizes Arrow SVG instead of treating it as PNG bytes", async () => {
	const svg = new TextEncoder().encode(
		'<svg xmlns="http://www.w3.org/2000/svg"/>',
	);
	const png = new Uint8Array([137, 80, 78, 71]);
	mocks.createGateway.mockReturnValue({ imageModel: mocks.imageModel });
	mocks.generateImage.mockResolvedValue({
		image: { uint8Array: svg, mediaType: "image/svg+xml" },
	});
	const rasterize = vi.fn().mockResolvedValue(png);
	expect(
		await createGatewayImageProvider("key", rasterize).generate({
			modelId: "quiverai/arrow-1.1",
			prompt: "A vector logo",
			size: "1024x1024",
		}),
	).toEqual({ bytes: png, mimeType: "image/png" });
	expect(rasterize).toHaveBeenCalledWith(svg);
	expect(mocks.generateImage.mock.calls[0]?.[0]).not.toHaveProperty("size");
	await expect(
		createGatewayImageProvider("key").generate({
			modelId: "quiverai/arrow-1.1",
			prompt: "x",
			size: "1024x1024",
		}),
	).rejects.toThrow("SVG rendering is unavailable");
});

it.each([
	[
		"openai/gpt-image-2.5-flare",
		"1536x864",
		{ openai: { quality: "high", outputFormat: "png" } },
	],
	[
		"bfl/flux-2-max",
		"1024x576",
		{ blackForestLabs: { width: 1024, height: 576 } },
	],
] as const)(
	"sends %s native settings",
	async (modelId, size, providerOptions) => {
		mocks.createGateway.mockReturnValue({ imageModel: mocks.imageModel });
		mocks.generateImage.mockResolvedValue({
			image: { uint8Array: new Uint8Array([1]), mediaType: "image/png" },
		});
		await createGatewayImageProvider("key").generate({
			modelId,
			size,
			prompt: "x",
			quality: "high",
		});
		expect(mocks.generateImage).toHaveBeenCalledWith(
			expect.objectContaining({ size, providerOptions }),
		);
	},
);

it.each(["bfl/flux-pro-1.1-ultra", "spacexai/grok-imagine-image-2.0"])(
	"uses aspect ratio instead of unsupported dimensions for %s",
	async (modelId) => {
		mocks.createGateway.mockReturnValue({ imageModel: mocks.imageModel });
		mocks.generateImage.mockResolvedValue({
			image: { uint8Array: new Uint8Array([1]), mediaType: "image/png" },
		});
		await createGatewayImageProvider("key").generate({
			modelId,
			size: "576x1024",
			prompt: "x",
		});
		expect(mocks.generateImage.mock.calls[0]?.[0]).toMatchObject({
			aspectRatio: "9:16",
		});
		expect(mocks.generateImage.mock.calls[0]?.[0]).not.toHaveProperty("size");
	},
);

it("does not send Fish delivery directions to Grok TTS", async () => {
	mocks.createGateway.mockReturnValue({ speechModel: mocks.speechModel });
	mocks.generateSpeech.mockResolvedValue({
		audio: { uint8Array: new Uint8Array([1]), mediaType: "audio/mpeg" },
	});
	await createGatewaySpeechProvider("key").generate({
		modelId: "spacexai/grok-tts",
		voiceId: "eve",
		voiceDirection: "",
		text: "Hello [pause] world",
	});
	expect(mocks.speechModel).toHaveBeenCalledWith("spacexai/grok-tts");
	expect(mocks.generateSpeech).toHaveBeenCalledWith(
		expect.objectContaining({
			voice: "eve",
			text: "Hello [pause] world",
			outputFormat: "mp3",
		}),
	);
});

it.each([
	["openai/tts-1", "alloy", ""],
	["openai/tts-1-hd", "nova", ""],
	["fish-audio/s1", "933563129e564b19a115bedd57b7406a", ""],
	["fish-audio/s2-pro", "933563129e564b19a115bedd57b7406a", "warm"],
])(
	"routes %s with the provider's voice and supported delivery controls",
	async (modelId, voiceId, voiceDirection) => {
		mocks.createGateway.mockReturnValue({ speechModel: mocks.speechModel });
		mocks.speechModel.mockReturnValue("speech-model");
		mocks.generateSpeech.mockResolvedValue({
			audio: { uint8Array: new Uint8Array([1]), mediaType: "audio/mpeg" },
		});
		await createGatewaySpeechProvider("key").generate({
			modelId,
			voiceId,
			voiceDirection,
			text: "Welcome",
		});
		expect(mocks.speechModel).toHaveBeenCalledWith(modelId);
		expect(mocks.generateSpeech).toHaveBeenCalledWith(
			expect.objectContaining({
				voice: voiceId,
				text: voiceDirection ? "[warm] Welcome" : "Welcome",
				outputFormat: "mp3",
			}),
		);
		expect(mocks.generateSpeech.mock.calls[0]?.[0]).not.toHaveProperty(
			"instructions",
		);
	},
);

it("rejects unavailable workflows and incompatible voices before contacting Gateway", async () => {
	await expect(
		createGatewayProvider("key").generate({
			modelId: "openai/whisper-1",
			prompt: "x",
		}),
	).rejects.toThrow("Transcription");
	await expect(
		createGatewayImageProvider("key").generate({
			modelId: "bfl/flux-pro-1.0-fill",
			prompt: "x",
			size: "1024x1024",
		}),
	).rejects.toThrow("mask");
	await expect(
		createGatewaySpeechProvider("key").generate({
			modelId: "openai/tts-1",
			voiceId: "eve",
			text: "x",
			voiceDirection: "",
		}),
	).rejects.toThrow("voice");
	expect(mocks.createGateway).not.toHaveBeenCalled();
});

it("sends Kontext an aspect ratio and reference image", async () => {
	const bytes = new Uint8Array([1]);
	mocks.createGateway.mockReturnValue({ imageModel: mocks.imageModel });
	mocks.generateImage.mockResolvedValue({
		image: { uint8Array: bytes, mediaType: "image/png" },
	});
	await createGatewayImageProvider("key").generate({
		modelId: "bfl/flux-kontext-pro",
		prompt: "Change the background",
		size: "1024x576",
		referenceImage: bytes,
	});
	expect(mocks.generateImage).toHaveBeenCalledWith(
		expect.objectContaining({
			aspectRatio: "16:9",
			prompt: { text: "Change the background", images: [bytes] },
		}),
	);
	expect(mocks.generateImage.mock.calls[0]?.[0]).not.toHaveProperty("size");
});

it("omits the unsupported resolution setting on original Nano Banana", async () => {
	mocks.generateText.mockResolvedValue({
		files: [{ uint8Array: new Uint8Array([1]), mediaType: "image/png" }],
	});
	await createGatewayImageProvider("key").generate({
		modelId: "google/gemini-2.5-flash-image",
		prompt: "A tree",
		size: "1024x576",
	});
	expect(
		mocks.generateText.mock.calls[0]?.[0].providerOptions.google.imageConfig,
	).toEqual({ aspectRatio: "16:9" });
});

it("sends typed image, video and audio content to a multimodal text model", async () => {
	const bytes = new Uint8Array([1, 2]);
	await createGatewayProvider("key").generate({
		modelId: "google/gemini-3.6-flash",
		prompt: "Summarize",
		media: [
			{ kind: "image", role: "context", bytes, mediaType: "image/png" },
			{ kind: "video", role: "context", bytes, mediaType: "video/mp4" },
			{ kind: "audio", role: "context", bytes, mediaType: "audio/mpeg" },
		],
	});
	expect(mocks.generateText).toHaveBeenCalledWith(
		expect.objectContaining({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Summarize" },
						{ type: "image", image: bytes, mediaType: "image/png" },
						{ type: "file", data: bytes, mediaType: "video/mp4" },
						{ type: "file", data: bytes, mediaType: "audio/mpeg" },
					],
				},
			],
		}),
	);
	await expect(
		createGatewayProvider("key").generate({
			modelId: "amazon/nova-micro",
			prompt: "Test",
			media: [
				{ kind: "image", role: "context", bytes, mediaType: "image/png" },
			],
		}),
	).rejects.toThrow("Unsupported media");
	expect(mocks.generateText).toHaveBeenCalledTimes(1);
});

it("sends all ordered image references to the image adapter", async () => {
	mocks.createGateway.mockReturnValue({ imageModel: mocks.imageModel });
	const first = new Uint8Array([1]);
	const second = new Uint8Array([2]);
	mocks.generateImage.mockResolvedValue({
		image: { uint8Array: first, mediaType: "image/png" },
	});
	await createGatewayImageProvider("key").generate({
		modelId: "bfl/flux-2-klein-4b",
		prompt: "Combine",
		size: "1024x1024",
		referenceImage: first,
		referenceImages: [second],
	});
	expect(mocks.generateImage).toHaveBeenCalledWith(
		expect.objectContaining({
			prompt: { text: "Combine", images: [first, second] },
		}),
	);
});
