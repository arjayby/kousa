import type {
	GenerationRun,
	GenerationStore,
} from "@kousa/db/generation-store";
import type { MediaService } from "@kousa/media/service";
import { generationImageOrigin } from "./image-origin";
import { validateMediaAssets } from "./media-inputs";
import type { MediaAttachment } from "./providers";

const hex = (bytes: Uint8Array) =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const mediaTokenHash = async (token: string) =>
	hex(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
		),
	);
export const mediaHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
	"Content-Security-Policy": "default-src 'none'; sandbox",
	"Referrer-Policy": "no-referrer",
	"X-Robots-Tag": "noindex, nofollow, noarchive",
};

export function createGenerationMediaAccess(
	store: Pick<GenerationStore, "get" | "setInputImageToken">,
	media: Pick<MediaService, "authorize" | "read">,
	derive?: (
		id: string,
		bytes: Uint8Array<ArrayBuffer>,
		output: "lastFrame" | "audio",
	) => Promise<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string }>,
) {
	async function current(id: string) {
		const run = await store.get(id);
		if (
			!run?.projectId ||
			run.status !== "running" ||
			run.expiresAt.getTime() <= Date.now()
		)
			throw new Error("Unavailable media input");
		await media.authorize(run.userId, run.projectId, true);
		return run;
	}
	async function read(run: GenerationRun, index: number) {
		const input = run.resolvedInputs?.media?.[index];
		if (!input?.assetId) throw new Error("Unavailable media input");
		const result = await media.read(run.userId, run.projectId, input.assetId);
		try {
			await validateMediaAssets(
				{ get: async () => result.asset },
				run.projectId ?? "",
				[input],
				run.modelId,
				run.kind === "video",
			);
			const max = input.kind === "video" || input.output ? 20 : 10;
			if (result.asset.bytes > max * 1024 * 1024)
				throw new Error("Media input too large");
		} catch (error) {
			await result.object.body.cancel();
			throw error;
		}
		return { ...result, input };
	}
	return {
		async load(value: GenerationRun): Promise<MediaAttachment[]> {
			const run = await current(value.id);
			const entries = run.resolvedInputs?.media ?? [];
			if (!entries.length) return [];
			let token: string | undefined;
			const origin = generationImageOrigin(run.inputImageOrigin ?? undefined);
			if (run.kind === "video" && !run.modelId.startsWith("google/")) {
				if (!origin) throw new Error("Video input delivery unavailable");
				token = hex(crypto.getRandomValues(new Uint8Array(32)));
				if (
					!(await store.setInputImageToken(run.id, await mediaTokenHash(token)))
				)
					throw new Error("Could not authorize media delivery");
			}
			const loaded: MediaAttachment[] = [];
			let total = 0;
			for (const [index] of entries.entries()) {
				const { asset, object, input } = await read(run, index);
				total += asset.bytes;
				if (total > 40 * 1024 * 1024) {
					await object.body.cancel();
					throw new Error("Media inputs exceed 40 MB");
				}
				if (token) {
					// Google requires reference bytes. Other providers fetch the scoped URL.
					if (!run.modelId.startsWith("google/")) {
						if (input.output) {
							const bytes = await readBytes(object.body, asset.bytes);
							if (!(await derive?.(run.id, bytes, input.output)))
								throw new Error("Video output extraction unavailable");
						} else await object.body.cancel();
						loaded.push({
							kind: input.kind,
							role: input.role,
							mediaType:
								input.output === "lastFrame"
									? "image/png"
									: input.output === "audio"
										? "audio/mpeg"
										: asset.mimeType,
							url: `${origin}/api/generation-inputs/${run.id}?token=${token}&media=${index}`,
						});
						continue;
					}
				}
				const original = await readBytes(object.body, asset.bytes);
				const extracted = input.output
					? await derive?.(run.id, original, input.output)
					: null;
				if (input.output && !extracted)
					throw new Error("Video extraction unavailable");
				loaded.push({
					kind: input.kind,
					role: input.role,
					mediaType: extracted?.mimeType ?? asset.mimeType,
					bytes: extracted?.bytes ?? original,
				});
			}
			return loaded;
		},
		async handle(request: Request, runId: string) {
			try {
				if (!["GET", "HEAD"].includes(request.method))
					return new Response(null, {
						status: 405,
						headers: { ...mediaHeaders, Allow: "GET, HEAD" },
					});
				const params = new URL(request.url).searchParams;
				const token = params.get("token") ?? "";
				const index = params.get("media") ?? "";
				if (!/^[a-f0-9]{64}$/.test(token) || !/^[0-7]$/.test(index))
					throw new Error("Invalid media request");
				const run = await current(runId);
				if (
					run.kind !== "video" ||
					run.inputImageTokenHash !== (await mediaTokenHash(token))
				)
					throw new Error("Unavailable media input");
				const { asset, object, input } = await read(run, Number(index));
				if (input.output) {
					const bytes = await readBytes(object.body, asset.bytes);
					const result = await derive?.(run.id, bytes, input.output);
					if (!result) throw new Error("Video extraction unavailable");
					return new Response(request.method === "HEAD" ? null : result.bytes, {
						headers: {
							...mediaHeaders,
							"Content-Type": result.mimeType,
							"Content-Length": String(result.bytes.length),
						},
					});
				}
				if (request.method === "HEAD") await object.body.cancel();
				return new Response(request.method === "HEAD" ? null : object.body, {
					headers: {
						...mediaHeaders,
						"Content-Type": asset.mimeType,
						"Content-Length": String(object.bytes),
					},
				});
			} catch {
				return new Response(null, { status: 404, headers: mediaHeaders });
			}
		},
	};
}

async function readBytes(body: ReadableStream<Uint8Array>, expected: number) {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.length;
			if (length > expected) throw new Error("Invalid media input");
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	if (!length || length !== expected) throw new Error("Incomplete media input");
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}
