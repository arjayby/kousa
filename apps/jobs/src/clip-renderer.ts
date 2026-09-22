import { Container } from "@cloudflare/containers";
import type { ClipRenderer } from "@kousa/media/clip-runner";
import { maxVideoBytes } from "@kousa/media/contracts";

export class ClipRendererContainer extends Container {
	defaultPort = 8790;
	sleepAfter = "1m";
	enableInternet = false;
}
export type RendererEnv = {
	CLIP_RENDERER?: DurableObjectNamespace<ClipRendererContainer>;
	CLIP_RENDERER_URL?: string;
};
export async function rendererConfigured(env: RendererEnv) {
	if (env.CLIP_RENDERER) return true;
	if (!env.CLIP_RENDERER_URL) return false;
	try {
		return (
			await fetch(`${env.CLIP_RENDERER_URL}/health`, {
				signal: AbortSignal.timeout(1500),
			})
		).ok;
	} catch {
		return false;
	}
}
export function clipRenderer(env: RendererEnv): ClipRenderer {
	return async (id, video, audio, plan) => {
		const body = new FormData();
		body.set("video", new Blob([video], { type: "video/mp4" }), "video.mp4");
		body.set("audio", new Blob([audio], { type: "audio/mpeg" }), "speech.mp3");
		body.set(
			"settings",
			JSON.stringify({
				narrationStartMs: plan.narrationStartMs,
				narrationVolume: plan.narrationVolume,
				videoVolume: plan.videoVolume,
			}),
		);
		const init = { method: "POST", body, signal: AbortSignal.timeout(180_000) };
		const response = env.CLIP_RENDERER
			? await env.CLIP_RENDERER.get(env.CLIP_RENDERER.idFromName(id)).fetch(
					"http://container/render",
					init,
				)
			: env.CLIP_RENDERER_URL
				? await fetch(`${env.CLIP_RENDERER_URL}/render`, init)
				: null;
		if (!response?.ok) throw new Error("Clip renderer unavailable");
		if (Number(response.headers.get("content-length")) > maxVideoBytes) {
			await response.body?.cancel();
			throw new Error("Clip too large");
		}
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Clip missing");
		let size = 0;
		const chunks: Uint8Array[] = [];
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > maxVideoBytes) {
					await reader.cancel();
					throw new Error("Clip too large");
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		const result = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}
		return result;
	};
}

export function videoOutputExtractor(env: RendererEnv) {
	return async (
		id: string,
		bytes: Uint8Array<ArrayBuffer>,
		output: "lastFrame" | "audio",
	) => {
		const body = new FormData();
		body.set("video", new Blob([bytes], { type: "video/mp4" }), "video.mp4");
		body.set("output", output);
		const init = { method: "POST", body, signal: AbortSignal.timeout(180_000) };
		const response = env.CLIP_RENDERER
			? await env.CLIP_RENDERER.get(env.CLIP_RENDERER.idFromName(id)).fetch(
					"http://container/extract",
					init,
				)
			: env.CLIP_RENDERER_URL
				? await fetch(`${env.CLIP_RENDERER_URL}/extract`, init)
				: null;
		if (!response?.ok || !response.body)
			throw new Error("Video output extraction unavailable");
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				length += value.length;
				if (length > 10 * 1024 * 1024)
					throw new Error("Extracted output too large");
				chunks.push(value);
			}
		} finally {
			await reader.cancel();
			reader.releaseLock();
		}
		const result = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}
		return {
			bytes: result,
			mimeType: output === "lastFrame" ? "image/png" : "audio/mpeg",
		};
	};
}
