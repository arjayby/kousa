import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	model: vi.fn(),
	createGateway: vi.fn(),
}));
vi.mock("ai", () => ({
	generateText: mocks.generateText,
	createGateway: mocks.createGateway,
}));

import { createGatewayProvider } from "../src/gateway";

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
