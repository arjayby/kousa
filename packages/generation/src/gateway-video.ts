import { maxVideoBytes } from "@kousa/media/contracts";
import {
	createGateway,
	experimental_getVideoStatus as getVideoStatus,
	experimental_startVideo as startVideo,
} from "ai";
import { z } from "zod";
import { validateModelSettings, videoProfile } from "./model-catalog";
import type { VideoProvider } from "./providers";

// Only provider-returned HTTPS URLs reach this downloader. Never forward the
// Gateway key or follow an unchecked redirect to an internal service.
function downloadUrl(value: string) {
	const url = new URL(value);
	const host = url.hostname.toLowerCase();
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		(url.port && url.port !== "443") ||
		!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host) ||
		/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
		host.endsWith(".arpa")
	)
		throw new Error("Invalid video download URL");
	return url;
}
async function download(value: string) {
	let url = downloadUrl(value);
	const signal = AbortSignal.timeout(60_000);
	for (let redirects = 0; redirects <= 3; redirects++) {
		const response = await fetch(url, { redirect: "manual", signal });
		if ([301, 302, 303, 307, 308].includes(response.status)) {
			await response.body?.cancel();
			const location = response.headers.get("location");
			if (!location) throw new Error("Missing video redirect");
			url = downloadUrl(new URL(location, url).href);
			continue;
		}
		if (
			!response.ok ||
			!response.body ||
			Number(response.headers.get("content-length")) > maxVideoBytes
		) {
			await response.body?.cancel();
			throw new Error("Video download unavailable or too large");
		}
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			while (true) {
				const { value: chunk, done } = await reader.read();
				if (done) break;
				size += chunk.length;
				if (size > maxVideoBytes) throw new Error("Video exceeds 20 MB");
				chunks.push(chunk);
			}
		} finally {
			await reader.cancel();
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}
		return bytes;
	}
	throw new Error("Too many video redirects");
}

export function createGatewayVideoProvider(
	apiKey: string | undefined,
): VideoProvider {
	return {
		configured: Boolean(apiKey?.trim()),
		async start({
			id,
			modelId,
			prompt,
			imageUrl,
			media = [],
			aspectRatio,
			duration,
		}) {
			const error = validateModelSettings(
				{ kind: "video", modelId, aspectRatio, duration },
				Boolean(imageUrl) || media.some((input) => input.kind !== "audio"),
			);
			if (error) throw new Error(error);
			const profile = videoProfile(modelId);
			// Explicit native tiers avoid each provider interpreting WxH differently.
			const tier = profile.resolution;
			const resolution =
				tier === "480p"
					? modelId.startsWith("alibaba/")
						? "832x480"
						: "854x480"
					: tier === "768p"
						? "1366x768"
						: "1280x720";
			const providerOptions: Parameters<
				typeof startVideo
			>[0]["providerOptions"] = modelId.startsWith("bfl/")
				? { blackForestLabs: { resolution: "hd" } }
				: modelId.startsWith("minimax/")
					? { minimax: { resolution: tier.toUpperCase() } }
					: modelId.startsWith("bytedance/")
						? { bytedance: { resolution: tier } }
						: modelId.startsWith("klingai/")
							? { klingai: { mode: "pro" } }
							: modelId.startsWith("spacexai/")
								? { xai: { resolution: tier } }
								: undefined;
			const data = (input: (typeof media)[number]) => {
				if (input.url) return input.url;
				if (input.bytes) return input.bytes;
				throw new Error("Missing input media");
			};
			const first = media.find((input) => input.role === "firstFrame");
			const startingImage = imageUrl ?? (first ? data(first) : undefined);
			const last = media.find((input) => input.role === "lastFrame");
			const references = media.filter(
				(input) => input.role !== "lastFrame" && input.role !== "firstFrame",
			);
			if (last && (!startingImage || !profile.lastFrame))
				throw new Error("Unsupported last frame");
			if (references.length && startingImage && !profile.referenceOnly)
				throw new Error("Cannot mix frames and references");
			for (const input of references) {
				if (
					(input.kind === "image" && !profile.referenceImages) ||
					(input.kind === "video" && !profile.referenceVideo) ||
					(input.kind === "audio" && !profile.referenceAudio)
				)
					throw new Error("Unsupported video reference");
			}
			const audio = references.filter((input) => input.kind === "audio");
			if (audio.length) {
				if (modelId.startsWith("bytedance/"))
					Object.assign(providerOptions ?? {}, {
						bytedance: {
							resolution: tier,
							referenceAudio: audio.map(data),
							generateAudio: true,
						},
					});
				else if (modelId.startsWith("minimax/"))
					Object.assign(providerOptions ?? {}, {
						minimax: {
							resolution: tier.toUpperCase(),
							referenceAudioUrls: audio.map(data),
						},
					});
			}
			const inputReferences = [
				...(startingImage && profile.referenceOnly ? [startingImage] : []),
				...references
					.filter((input) => input.kind !== "audio")
					.map((input) => ({ data: data(input), mediaType: input.mediaType })),
			];
			const result = await startVideo({
				model: createGateway({ apiKey }).videoModel(modelId),
				prompt:
					startingImage && !profile.referenceOnly && !last
						? { text: prompt, image: startingImage }
						: prompt,
				...(last && startingImage
					? {
							frameImages: [
								{ frameType: "first_frame" as const, image: startingImage },
								{ frameType: "last_frame" as const, image: data(last) },
							],
						}
					: {}),
				...(inputReferences.length ? { inputReferences } : {}),
				...(startingImage && profile.imageDeterminesRatio
					? {}
					: { aspectRatio }),
				...(modelId.startsWith("klingai/") ? {} : { resolution }),
				providerOptions:
					modelId.startsWith("alibaba/") && audio.length
						? { ...providerOptions, alibaba: { audioUrl: audio[0]?.url ?? "" } }
						: providerOptions,
				duration,
				n: 1,
				headers: { "idempotency-key": id },
				maxRetries: 0,
				abortSignal: AbortSignal.timeout(60_000),
			});
			return result.operation;
		},
		async poll({ modelId, operation }) {
			const result = await getVideoStatus(
				createGateway({ apiKey }).videoModel(modelId),
				{
					operation: z.json().parse(operation),
					maxRetries: 0,
					abortSignal: AbortSignal.timeout(60_000),
				},
			);
			if (result.status === "pending") return { status: "pending" };
			if (result.status === "error") return { status: "failed" };
			const video = result.videos[0];
			if (
				result.videos.length !== 1 ||
				!video ||
				video.mediaType !== "video/mp4"
			)
				return { status: "failed" };
			let bytes: Uint8Array<ArrayBuffer>;
			if (video.type === "url") bytes = await download(video.url);
			else if (video.type === "base64") {
				if (video.data.length > Math.ceil(maxVideoBytes / 3) * 4)
					return { status: "failed" };
				bytes = Uint8Array.from(atob(video.data), (c) => c.charCodeAt(0));
			} else bytes = new Uint8Array(video.data);
			if (!bytes.length || bytes.length > maxVideoBytes)
				return { status: "failed" };
			return { status: "succeeded", bytes, mimeType: "video/mp4" };
		},
	};
}
