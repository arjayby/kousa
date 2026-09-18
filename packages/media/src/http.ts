import { z } from "zod";
import { maxImageBytes, maxVideoBytes, mediaParams } from "./contracts";
import type { MediaLifecycle } from "./lifecycle";
import { MediaRangeError } from "./range";
import { MediaError, type MediaService } from "./service";

const privateHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
	"Cross-Origin-Resource-Policy": "same-origin",
};
async function readBody(request: Request) {
	const limit =
		request.headers.get("content-type") === "video/mp4"
			? maxVideoBytes
			: maxImageBytes;
	const length = Number(request.headers.get("content-length"));
	if (length > limit)
		throw new MediaError(413, "Media exceeds its upload size limit.");
	if (!request.body)
		throw new MediaError(400, "Choose a media file to upload.");
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw new MediaError(413, "Media exceeds its upload size limit.");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}
export function createMediaHandler(deps: {
	actor: (request: Request) => Promise<string | null>;
	service: () => MediaService;
	lifecycle?: () => MediaLifecycle;
}) {
	return async (request: Request, input: unknown) => {
		try {
			const { projectId, assetId } = mediaParams.parse(input);
			if (!["GET", "HEAD", "POST", "DELETE"].includes(request.method))
				throw new MediaError(405, "Method not allowed.");
			if (
				(request.method === "POST" || request.method === "DELETE") &&
				request.headers.get("origin") !== new URL(request.url).origin
			)
				throw new MediaError(403, "Upload from the Kousa app.");
			const actorId = await deps.actor(request);
			if (!actorId)
				throw new MediaError(401, "Sign in to access project media.");
			const service = deps.service();
			if (
				assetId &&
				(request.method === "POST" || request.method === "DELETE")
			) {
				const lifecycle = deps.lifecycle?.();
				if (!lifecycle)
					throw new MediaError(503, "Media management is unavailable.");
				if (request.method === "POST")
					await lifecycle.retain(actorId, projectId, assetId);
				else await lifecycle.remove(actorId, projectId, assetId);
				return Response.json({ ok: true }, { headers: privateHeaders });
			}
			if (request.method === "DELETE")
				throw new MediaError(405, "Choose a file to remove.");
			if (request.method === "POST") {
				await service.authorize(actorId, projectId, true);
				let name: string;
				try {
					name = decodeURIComponent(
						request.headers.get("x-file-name") ?? "Media",
					);
				} catch {
					throw new MediaError(400, "Invalid filename.");
				}
				const asset = await service.upload(
					actorId,
					projectId,
					{
						name,
						mimeType: request.headers.get("content-type") ?? "",
						bytes: await readBody(request),
					},
					request.headers.get("x-kousa-media-lifecycle") === "1" &&
						request.headers.get("x-kousa-library-only") === "1",
				);
				return Response.json(
					{ asset },
					{ status: 201, headers: privateHeaders },
				);
			}
			if (!assetId) {
				if (new URL(request.url).searchParams.get("view") === "lifecycle") {
					if (!deps.lifecycle)
						throw new MediaError(503, "Media management is unavailable.");
					return Response.json(
						await deps.lifecycle().inspect(actorId, projectId),
						{ headers: privateHeaders },
					);
				}
				if (request.headers.get("x-kousa-media-lifecycle") !== "1")
					await deps.lifecycle?.().protectLegacyList(actorId, projectId);
				return Response.json(
					{ assets: await service.list(actorId, projectId) },
					{ headers: privateHeaders },
				);
			}
			const { asset, object, range } = await service.read(
				actorId,
				projectId,
				assetId,
				request.method === "HEAD" ? null : request.headers.get("range"),
			);
			if (request.method === "HEAD") await object.body.cancel();
			return new Response(request.method === "HEAD" ? null : object.body, {
				status: range ? 206 : 200,
				headers: {
					...privateHeaders,
					"Content-Type": asset.mimeType,
					"Accept-Ranges": "bytes",
					...(range
						? {
								"Content-Range": `bytes ${range.offset}-${range.offset + range.length - 1}/${asset.bytes}`,
							}
						: {}),
					"Content-Length": String(object.bytes),
					"Content-Disposition": `inline; filename="media"; filename*=UTF-8''${encodeURIComponent(asset.name).replace(/'/g, "%27")}`,
					"Content-Security-Policy": "default-src 'none'; sandbox",
				},
			});
		} catch (error) {
			if (error instanceof MediaRangeError)
				return new Response(null, {
					status: 416,
					headers: {
						...privateHeaders,
						"Content-Range": `bytes */${error.total}`,
					},
				});
			const status =
				error instanceof MediaError
					? error.status
					: error instanceof z.ZodError
						? 400
						: 503;
			const message =
				error instanceof MediaError
					? error.message
					: status === 400
						? "Invalid media request."
						: "Media storage is unavailable. Refresh and retry the same action.";
			return Response.json({ message }, { status, headers: privateHeaders });
		}
	};
}
