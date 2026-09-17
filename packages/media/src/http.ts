import { z } from "zod";
import { maxImageBytes, mediaParams } from "./contracts";
import { MediaError, type MediaService } from "./service";

const privateHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
	"Cross-Origin-Resource-Policy": "same-origin",
};
async function readBody(request: Request) {
	const length = Number(request.headers.get("content-length"));
	if (length > maxImageBytes)
		throw new MediaError(413, "Choose an image up to 10 MB.");
	if (!request.body) throw new MediaError(400, "Choose an image to upload.");
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxImageBytes) {
				await reader.cancel();
				throw new MediaError(413, "Choose an image up to 10 MB.");
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
}) {
	return async (request: Request, input: unknown) => {
		try {
			const { projectId, assetId } = mediaParams.parse(input);
			if (request.method !== "GET" && request.method !== "POST")
				throw new MediaError(405, "Method not allowed.");
			if (
				request.method === "POST" &&
				(request.headers.get("origin") !== new URL(request.url).origin ||
					assetId)
			)
				throw new MediaError(403, "Upload from the Kousa app.");
			const actorId = await deps.actor(request);
			if (!actorId)
				throw new MediaError(401, "Sign in to access project media.");
			const service = deps.service();
			if (request.method === "POST") {
				await service.authorize(actorId, projectId, true);
				let name: string;
				try {
					name = decodeURIComponent(
						request.headers.get("x-file-name") ?? "Image",
					);
				} catch {
					throw new MediaError(400, "Invalid filename.");
				}
				const asset = await service.upload(actorId, projectId, {
					name,
					mimeType: request.headers.get("content-type") ?? "",
					bytes: await readBody(request),
				});
				return Response.json(
					{ asset },
					{ status: 201, headers: privateHeaders },
				);
			}
			if (!assetId)
				return Response.json(
					{ assets: await service.list(actorId, projectId) },
					{ headers: privateHeaders },
				);
			const { asset, object } = await service.read(actorId, projectId, assetId);
			return new Response(object.body, {
				headers: {
					...privateHeaders,
					"Content-Type": asset.mimeType,
					"Content-Length": String(object.bytes),
					"Content-Disposition": `inline; filename="image"; filename*=UTF-8''${encodeURIComponent(asset.name).replace(/'/g, "%27")}`,
					"Content-Security-Policy": "default-src 'none'; sandbox",
				},
			});
		} catch (error) {
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
						: "Media storage is unavailable. Please retry the same file.";
			return Response.json({ message }, { status, headers: privateHeaders });
		}
	};
}
