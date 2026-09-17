import { maxVideoBytes } from "@kousa/media/contracts";
import {
	createGateway,
	experimental_getVideoStatus as getVideoStatus,
	experimental_startVideo as startVideo,
} from "ai";
import { z } from "zod";
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
		async start({ id, modelId, prompt, aspectRatio, duration }) {
			const result = await startVideo({
				model: createGateway({ apiKey }).videoModel(modelId),
				prompt,
				aspectRatio,
				resolution: "854x480",
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
