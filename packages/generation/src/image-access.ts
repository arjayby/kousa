import type {
	GenerationRun,
	GenerationStore,
} from "@kousa/db/generation-store";
import { imageMimeTypes, maxImageBytes } from "@kousa/media/contracts";
import { MediaError, type MediaService } from "@kousa/media/service";
import { z } from "zod";
import { generationImageOrigin } from "./image-origin";

const headers = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
	"Content-Security-Policy": "default-src 'none'; sandbox",
	"Referrer-Policy": "no-referrer",
	"X-Robots-Tag": "noindex, nofollow, noarchive",
};
const hex = (bytes: Uint8Array) =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
async function tokenHash(token: string) {
	return hex(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
		),
	);
}

export function createGenerationImageAccess(
	store: Pick<GenerationStore, "get" | "setInputImageToken">,
	media: Pick<MediaService, "authorize" | "read">,
) {
	async function read(run: GenerationRun) {
		if (!run.inputImageAssetId) throw new MediaError(404, "Unavailable image");
		await media.authorize(run.userId, run.projectId, true);
		const result = await media.read(
			run.userId,
			run.projectId,
			run.inputImageAssetId,
		);
		if (
			!imageMimeTypes.some((type) => type === result.asset.mimeType) ||
			result.asset.bytes > maxImageBytes
		) {
			await result.object.body.cancel();
			throw new MediaError(404, "Unavailable image");
		}
		return result;
	}
	return {
		async bytes(run: GenerationRun) {
			const current = await store.get(run.id);
			if (
				current?.kind !== "image" ||
				current.status !== "running" ||
				current.expiresAt.getTime() <= Date.now()
			)
				throw new MediaError(404, "Unavailable image");
			const { object, asset } = await read(current);
			const reader = object.body.getReader();
			const chunks: Uint8Array[] = [];
			let length = 0;
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					length += value.byteLength;
					if (length > maxImageBytes || length > asset.bytes)
						throw new MediaError(404, "Unavailable image");
					chunks.push(value);
				}
				if (!length || length !== asset.bytes)
					throw new MediaError(404, "Unavailable image");
				const bytes = new Uint8Array(length);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
				return bytes;
			} finally {
				await reader.cancel();
				reader.releaseLock();
			}
		},
		async issue(run: GenerationRun) {
			const origin = generationImageOrigin(run.inputImageOrigin ?? undefined);
			if (run.kind !== "video" || !origin)
				throw new Error("Image delivery unavailable");
			const { object } = await read(run);
			await object.body.cancel();
			const token = hex(crypto.getRandomValues(new Uint8Array(32)));
			if (!(await store.setInputImageToken(run.id, await tokenHash(token))))
				throw new Error("Could not authorize image delivery");
			return `${origin}/api/generation-inputs/${run.id}?token=${token}`;
		},
		async handle(request: Request, runId: string) {
			try {
				if (request.method !== "GET" && request.method !== "HEAD")
					return new Response(null, {
						status: 405,
						headers: { ...headers, Allow: "GET, HEAD" },
					});
				const token = new URL(request.url).searchParams.get("token") ?? "";
				if (!z.uuid().safeParse(runId).success || !/^[a-f0-9]{64}$/.test(token))
					return new Response(null, { status: 404, headers });
				const run = await store.get(runId);
				if (
					run?.kind !== "video" ||
					run.status !== "running" ||
					run.expiresAt.getTime() <= Date.now() ||
					!run.inputImageTokenHash ||
					run.inputImageTokenHash !== (await tokenHash(token))
				)
					return new Response(null, { status: 404, headers });
				const { asset, object } = await read(run);
				if (request.method === "HEAD") await object.body.cancel();
				return new Response(request.method === "HEAD" ? null : object.body, {
					headers: {
						...headers,
						"Content-Type": asset.mimeType,
						"Content-Length": String(object.bytes),
						"Content-Disposition": 'inline; filename="input-image"',
					},
				});
			} catch (error) {
				// Never return the token, storage key, project, or membership details.
				return new Response(null, {
					status: error instanceof MediaError ? 404 : 503,
					headers,
				});
			}
		},
	};
}
