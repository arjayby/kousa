import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	generateImage: vi.fn(),
	imageModel: vi.fn(),
	model: vi.fn(),
	createGateway: vi.fn(),
}));
vi.mock("ai", () => ({
	generateText: mocks.generateText,
	generateImage: mocks.generateImage,
	createGateway: mocks.createGateway,
}));

import {
	createGatewayImageProvider,
	createGatewayProvider,
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
