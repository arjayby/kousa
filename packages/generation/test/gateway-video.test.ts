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
it("sends a hosted starting image with an optional motion prompt", async () => {
	const imageUrl =
		"https://kousa.app/api/generation-inputs/run?token=scoped-token";
	await provider().start({
		id: "run-id",
		modelId: defaultVideoModel,
		prompt: "",
		imageUrl,
		aspectRatio: "1:1",
		duration: 5,
	});
	expect(mocks.start).toHaveBeenCalledWith(
		expect.objectContaining({
			prompt: { text: "", image: imageUrl },
			maxRetries: 0,
			headers: { "idempotency-key": "run-id" },
		}),
	);
	expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
	[
		"bfl/flux-3-video",
		5,
		"1280x720",
		{ blackForestLabs: { resolution: "hd" } },
	],
	["minimax/minimax-h3", 4, "1366x768", { minimax: { resolution: "768P" } }],
	["minimax/minimax-h3-max", 5, "854x480", { minimax: { resolution: "480P" } }],
	["google/veo-3.1-generate-001", 6, "1280x720", undefined],
	["klingai/kling-v3.0-t2v", 7, undefined, { klingai: { mode: "pro" } }],
	["alibaba/wan-v3.0-video", 2, "832x480", undefined],
	["alibaba/wan-v3.0-video-prime", 5, "832x480", undefined],
	["google/veo-3.1-lite-generate-001", 4, "1280x720", undefined],
	["klingai/kling-v2.6-t2v", 5, undefined, { klingai: { mode: "pro" } }],
	[
		"bytedance/seedance-v1.5-pro",
		5,
		"854x480",
		{ bytedance: { resolution: "480p" } },
	],
	[
		"spacexai/grok-imagine-video-1.5",
		1,
		"854x480",
		{ xai: { resolution: "480p" } },
	],
] as const)(
	"builds the %s video request",
	async (modelId, duration, resolution, providerOptions) => {
		await provider().start({
			id: "id",
			modelId,
			prompt: "Rain",
			duration,
			aspectRatio: "16:9",
		});
		expect(mocks.model).toHaveBeenCalledWith(modelId);
		if (!resolution)
			expect(mocks.start.mock.calls[0]?.[0]).not.toHaveProperty("resolution");
		expect(mocks.start).toHaveBeenCalledWith(
			expect.objectContaining({
				duration,
				...(resolution ? { resolution } : {}),
				providerOptions,
				headers: { "idempotency-key": "id" },
				maxRetries: 0,
			}),
		);
	},
);

it("inherits the starting image ratio for Kling instead of sending an ignored option", async () => {
	await provider().start({
		id: "id",
		modelId: "klingai/kling-v3.0-i2v",
		prompt: "Rain",
		imageUrl: "https://kousa.app/image.png",
		aspectRatio: "16:9",
		duration: 5,
	});
	expect(mocks.start.mock.calls[0]?.[0]).not.toHaveProperty("aspectRatio");
	expect(mocks.start.mock.calls[0]?.[0]).not.toHaveProperty("resolution");
});

it("uses Wan reference media rather than a starting frame", async () => {
	const imageUrl = "https://kousa.app/reference.png";
	await provider().start({
		id: "id",
		modelId: "alibaba/wan-v2.7-r2v",
		prompt: "Rain",
		imageUrl,
		aspectRatio: "16:9",
		duration: 5,
	});
	expect(mocks.start).toHaveBeenCalledWith(
		expect.objectContaining({ prompt: "Rain", inputReferences: [imageUrl] }),
	);
});

it("rejects unsupported settings before making a video request", async () => {
	await expect(
		provider().start({
			id: "id",
			modelId: "google/veo-3.1-generate-001",
			prompt: "Rain",
			aspectRatio: "16:9",
			duration: 5,
		}),
	).rejects.toThrow("duration");
	await expect(
		provider().start({
			id: "id",
			modelId: "klingai/kling-v3.0-i2v",
			prompt: "Rain",
			aspectRatio: "16:9",
			duration: 5,
		}),
	).rejects.toThrow("Connect an Image");
	expect(mocks.start).not.toHaveBeenCalled();
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

it("sends first and last frames without dropping the last frame", async () => {
	await provider().start({
		id: "run",
		modelId: "bytedance/seedance-2.0",
		prompt: "Move",
		imageUrl: "https://kousa.app/first",
		media: [
			{
				kind: "image",
				role: "lastFrame",
				url: "https://kousa.app/last",
				mediaType: "image/png",
			},
		],
		aspectRatio: "16:9",
		duration: 5,
	});
	expect(mocks.start).toHaveBeenCalledWith(
		expect.objectContaining({
			prompt: "Move",
			frameImages: [
				{ frameType: "first_frame", image: "https://kousa.app/first" },
				{ frameType: "last_frame", image: "https://kousa.app/last" },
			],
		}),
	);
});

it("sends typed image/video references and native audio references to Seedance", async () => {
	await provider().start({
		id: "run",
		modelId: "bytedance/seedance-2.0",
		prompt: "Match the motion",
		media: [
			{
				kind: "image",
				role: "reference",
				url: "https://kousa.app/image",
				mediaType: "image/png",
			},
			{
				kind: "video",
				role: "video",
				url: "https://kousa.app/video",
				mediaType: "video/mp4",
			},
			{
				kind: "audio",
				role: "audioReference",
				url: "https://kousa.app/audio",
				mediaType: "audio/mpeg",
			},
		],
		aspectRatio: "16:9",
		duration: 5,
	});
	expect(mocks.start).toHaveBeenCalledWith(
		expect.objectContaining({
			inputReferences: [
				{ data: "https://kousa.app/image", mediaType: "image/png" },
				{ data: "https://kousa.app/video", mediaType: "video/mp4" },
			],
			providerOptions: {
				bytedance: {
					resolution: "480p",
					referenceAudio: ["https://kousa.app/audio"],
					generateAudio: true,
				},
			},
		}),
	);
});

it("rejects unsupported media before any paid video call", async () => {
	await expect(
		provider().start({
			id: "run",
			modelId: defaultVideoModel,
			prompt: "Move",
			media: [
				{
					kind: "video",
					role: "video",
					url: "https://kousa.app/video",
					mediaType: "video/mp4",
				},
			],
			aspectRatio: "16:9",
			duration: 5,
		}),
	).rejects.toThrow("Unsupported video reference");
	expect(mocks.start).not.toHaveBeenCalled();
});
