import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultVideoModel } from "../src/contracts";

const mocks = vi.hoisted(() => ({
	start: vi.fn(),
	status: vi.fn(),
	model: vi.fn(),
	gateway: vi.fn(),
}));
vi.mock("ai", () => ({
	createGateway: mocks.gateway,
	experimental_startVideo: mocks.start,
	experimental_getVideoStatus: mocks.status,
}));

import { createGatewayVideoProvider } from "../src/gateway-video";

const fetchMock = vi.fn<typeof fetch>();
const provider = () => createGatewayVideoProvider("test-key");
const poll = () =>
	provider().poll({
		modelId: defaultVideoModel,
		operation: { job: "saved-job" },
	});
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("fetch", fetchMock);
	mocks.gateway.mockReturnValue({ videoModel: mocks.model });
	mocks.model.mockReturnValue("video-model");
	mocks.start.mockResolvedValue({ operation: { job: "saved-job" } });
	mocks.status.mockResolvedValue({ status: "pending" });
	fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it("submits one 480p video with a stable idempotency key and no SDK retry", async () => {
	expect(
		await provider().start({
			id: "run-id",
			modelId: defaultVideoModel,
			prompt: "Rain",
			aspectRatio: "9:16",
			duration: 10,
		}),
	).toEqual({ job: "saved-job" });
	expect(mocks.gateway).toHaveBeenCalledWith({ apiKey: "test-key" });
	expect(mocks.start).toHaveBeenCalledWith(
		expect.objectContaining({
			model: "video-model",
			prompt: "Rain",
			aspectRatio: "9:16",
			duration: 10,
			resolution: "854x480",
			n: 1,
			maxRetries: 0,
			headers: { "idempotency-key": "run-id" },
			abortSignal: expect.any(AbortSignal),
		}),
	);
	expect(createGatewayVideoProvider(undefined).configured).toBe(false);
});
it("polls the persisted operation and hides provider errors", async () => {
	expect(await poll()).toEqual({ status: "pending" });
	expect(mocks.status).toHaveBeenCalledWith(
		"video-model",
		expect.objectContaining({ operation: { job: "saved-job" }, maxRetries: 0 }),
	);
	mocks.status.mockResolvedValue({
		status: "error",
		message: "Sensitive provider detail",
	});
	expect(await poll()).toEqual({ status: "failed" });
	expect(mocks.start).not.toHaveBeenCalled();
});
it("downloads HTTPS results without Gateway credentials and returns private bytes", async () => {
	mocks.status.mockResolvedValue({
		status: "completed",
		videos: [
			{
				type: "url",
				url: "https://cdn.provider.com/video.mp4?signature=private",
				mediaType: "video/mp4",
			},
		],
	});
	fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
	expect(await poll()).toEqual({
		status: "succeeded",
		bytes: new Uint8Array([1, 2, 3]),
		mimeType: "video/mp4",
	});
	expect(fetchMock.mock.calls[0]?.[1]).toEqual({
		redirect: "manual",
		signal: expect.any(AbortSignal),
	});
});
it.each([
	"http://cdn.provider.com/v",
	"https://127.0.0.1/v",
	"https://[::1]/v",
	"https://jobs.internal/v",
	"https://user:pass@cdn.provider.com/v",
])("rejects unsafe hosted output %s", async (url) => {
	mocks.status.mockResolvedValue({
		status: "completed",
		videos: [{ type: "url", url, mediaType: "video/mp4" }],
	});
	await expect(poll()).rejects.toThrow("download URL");
	expect(fetchMock).not.toHaveBeenCalled();
});
it("checks redirect targets and bounds streamed output even without content-length", async () => {
	mocks.status.mockResolvedValue({
		status: "completed",
		videos: [
			{
				type: "url",
				url: "https://cdn.provider.com/v",
				mediaType: "video/mp4",
			},
		],
	});
	fetchMock.mockResolvedValueOnce(
		new Response(null, {
			status: 302,
			headers: { location: "https://169.254.169.254/credentials" },
		}),
	);
	await expect(poll()).rejects.toThrow("download URL");
	expect(fetchMock).toHaveBeenCalledTimes(1);
	fetchMock.mockResolvedValueOnce(
		new Response(new Uint8Array(20 * 1024 * 1024 + 1)),
	);
	await expect(poll()).rejects.toThrow("20 MB");
});
it("accepts inline bytes and base64 but refuses multiple clips and wrong media types", async () => {
	for (const item of [
		{ type: "base64", data: "AQID" },
		{ type: "binary", data: new Uint8Array([1, 2, 3]) },
	]) {
		mocks.status.mockResolvedValue({
			status: "completed",
			videos: [{ ...item, mediaType: "video/mp4" }],
		});
		expect(await poll()).toEqual({
			status: "succeeded",
			bytes: new Uint8Array([1, 2, 3]),
			mimeType: "video/mp4",
		});
	}
	const item = {
		type: "binary",
		data: new Uint8Array([1]),
		mediaType: "video/mp4",
	};
	mocks.status.mockResolvedValue({ status: "completed", videos: [item, item] });
	expect(await poll()).toEqual({ status: "failed" });
	mocks.status.mockResolvedValue({
		status: "completed",
		videos: [{ ...item, mediaType: "text/html" }],
	});
	expect(await poll()).toEqual({ status: "failed" });
});
