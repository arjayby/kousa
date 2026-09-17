import type { MediaAsset, MediaStore } from "@kousa/db/media-store";
import type { ProjectStore } from "@kousa/db/project-store";
import { imageSize } from "image-size";
import { imageMimeTypes, maxImageBytes, publicAssetSchema } from "./contracts";
import type { MediaStorage } from "./storage";

export class MediaError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}
const objectKey = (asset: MediaAsset) =>
	`projects/${asset.projectId}/images/${asset.id}`;
export function createMediaService(
	store: MediaStore,
	projects: Pick<ProjectStore, "get">,
	storage: MediaStorage,
) {
	async function authorize(actorId: string, projectId: string, write = false) {
		const project = await projects.get(actorId, projectId);
		if (!project) throw new MediaError(404, "Project not found.");
		if (write && project.role === "viewer")
			throw new MediaError(403, "Only owners and editors can upload images.");
	}
	// Generated files stay private until the generation ledger publishes them.
	async function stage(
		actorId: string,
		projectId: string,
		file: { bytes: Uint8Array<ArrayBuffer>; name: string; mimeType: string },
	) {
		await authorize(actorId, projectId, true);
		if (!file.bytes.length || file.bytes.length > maxImageBytes)
			throw new MediaError(413, "Choose an image up to 10 MB.");
		let dimensions: ReturnType<typeof imageSize>;
		try {
			dimensions = imageSize(file.bytes);
		} catch {
			throw new MediaError(415, "This file is not a supported image.");
		}
		const mimeType =
			dimensions.type === "jpg" ? "image/jpeg" : `image/${dimensions.type}`;
		if (
			!imageMimeTypes.some((type) => type === mimeType) ||
			mimeType !== file.mimeType
		)
			throw new MediaError(
				415,
				"Choose a PNG, JPEG, or WebP image with a matching file type.",
			);
		if (
			!dimensions.width ||
			!dimensions.height ||
			dimensions.width * dimensions.height > 40_000_000
		)
			throw new MediaError(413, "Images must be no larger than 40 megapixels.");
		const sha256 = Array.from(
			new Uint8Array(await crypto.subtle.digest("SHA-256", file.bytes)),
			(b) => b.toString(16).padStart(2, "0"),
		).join("");
		const name =
			Array.from(
				file.name
					// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip control characters from untrusted filenames.
					.replace(/[\u0000-\u001f\u007f/\\]/g, "")
					.trim(),
			)
				.slice(0, 180)
				.join("") || "Image";
		const asset = await store.reserve({
			projectId,
			uploaderId: actorId,
			sha256,
			name,
			mimeType,
			bytes: file.bytes.length,
			width: dimensions.width,
			height: dimensions.height,
		});
		if (asset === "forbidden")
			throw new MediaError(403, "Your editing access has changed.");
		if (asset === "full")
			throw new MediaError(
				409,
				"This project has reached its image limit (100 files or 100 MB).",
			);
		// Repeating the same upload safely resumes interrupted writes. No deletion on
		// uncertain completion: the database may have committed before the response failed.
		await storage.put(objectKey(asset), file.bytes, mimeType);
		return publicAssetSchema.parse(asset);
	}
	return {
		authorize,
		async list(actorId: string, projectId: string) {
			await authorize(actorId, projectId);
			return (await store.list(projectId)).map((asset) =>
				publicAssetSchema.parse(asset),
			);
		},
		stage,
		async upload(
			actorId: string,
			projectId: string,
			file: { bytes: Uint8Array<ArrayBuffer>; name: string; mimeType: string },
		) {
			const asset = await stage(actorId, projectId, file);
			const completed = await store.complete(actorId, asset.id);
			if (!completed)
				throw new MediaError(403, "Your editing access has changed.");
			return publicAssetSchema.parse(completed);
		},
		async read(actorId: string, projectId: string, assetId: string) {
			await authorize(actorId, projectId);
			const asset = await store.get(projectId, assetId);
			if (!asset) throw new MediaError(404, "Image not found.");
			const object = await storage.get(objectKey(asset));
			if (!object)
				throw new MediaError(
					404,
					"Image file is unavailable. An editor can upload it again.",
				);
			return { asset: publicAssetSchema.parse(asset), object };
		},
	};
}
export type MediaService = ReturnType<typeof createMediaService>;
