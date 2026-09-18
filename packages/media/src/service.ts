import type { MediaAsset, MediaStore } from "@kousa/db/media-store";
import type { ProjectStore } from "@kousa/db/project-store";
import { imageSize } from "image-size";
import { parseBuffer } from "music-metadata";
import {
	imageMimeTypes,
	maxAudioBytes,
	maxAudioDurationMs,
	maxImageBytes,
	projectAssetSchema,
	publicAssetSchema,
} from "./contracts";
import { parseMediaRange } from "./range";
import type { MediaStorage } from "./storage";
import { inspectVideo } from "./video";

export class MediaError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}
export const objectKey = (
	asset: Pick<MediaAsset, "id" | "projectId" | "mimeType">,
) =>
	`projects/${asset.projectId}/${asset.mimeType === "video/mp4" ? "videos" : asset.mimeType === "audio/mpeg" ? "audio" : "images"}/${asset.id}`;
type MediaFile = {
	bytes: Uint8Array<ArrayBuffer>;
	name: string;
	mimeType: string;
	retentionReason?: string | null;
	writeId?: string;
};

export function createMediaService(
	store: MediaStore,
	projects: Pick<ProjectStore, "get">,
	storage: MediaStorage,
) {
	async function authorize(actorId: string, projectId: string, write = false) {
		const project = await projects.get(actorId, projectId);
		if (!project) throw new MediaError(404, "Project not found.");
		if (write && project.role === "viewer")
			throw new MediaError(403, "Only owners and editors can save media.");
	}
	// Generated files stay private until the generation ledger publishes them.
	async function stage(actorId: string, projectId: string, file: MediaFile) {
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
		return save(actorId, projectId, file, {
			width: dimensions.width,
			height: dimensions.height,
			durationMs: null,
		});
	}
	async function stageSpeech(
		actorId: string,
		projectId: string,
		file: MediaFile,
	) {
		await authorize(actorId, projectId, true);
		if (!file.bytes.length || file.bytes.length > maxAudioBytes)
			throw new MediaError(413, "Audio must be between 1 byte and 10 MB.");
		if (file.mimeType !== "audio/mpeg")
			throw new MediaError(415, "Expected MP3 audio.");
		let durationMs: number;
		try {
			const { format } = await parseBuffer(
				file.bytes,
				{ mimeType: file.mimeType },
				{ duration: true, skipCovers: true },
			);
			if (
				format.container !== "MPEG" ||
				(format.codec !== "MPEG 1 Layer 3" &&
					format.codec !== "MPEG 2 Layer 3" &&
					format.codec !== "MPEG 2.5 Layer 3") ||
				!format.duration ||
				!Number.isFinite(format.duration)
			)
				throw new Error("Invalid MP3");
			durationMs = Math.ceil(format.duration * 1000);
		} catch {
			throw new MediaError(415, "The generated file is not valid MP3 audio.");
		}
		if (durationMs < 1 || durationMs > maxAudioDurationMs)
			throw new MediaError(413, "Audio must be no longer than 3 minutes.");
		return save(actorId, projectId, file, {
			width: null,
			height: null,
			durationMs,
		});
	}
	async function stageVideo(
		actorId: string,
		projectId: string,
		file: MediaFile,
		audio: "none" | "optional" | "required" = "none",
	) {
		await authorize(actorId, projectId, true);
		if (file.mimeType !== "video/mp4")
			throw new MediaError(415, "Expected MP4 video.");
		let metadata: ReturnType<typeof inspectVideo>;
		try {
			metadata = inspectVideo(file.bytes, audio);
		} catch {
			throw new MediaError(
				415,
				"Expected a complete H.264 MP4 with supported audio, up to 12 seconds and 20 MB.",
			);
		}
		return save(actorId, projectId, file, metadata);
	}
	async function save(
		actorId: string,
		projectId: string,
		file: MediaFile,
		metadata: {
			width: number | null;
			height: number | null;
			durationMs: number | null;
		},
	) {
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
				.join("") || "Media";
		const asset = await store.reserve({
			projectId,
			uploaderId: actorId,
			retentionReason: file.retentionReason,
			writeId: file.writeId,
			sha256,
			name,
			mimeType: file.mimeType,
			bytes: file.bytes.length,
			...metadata,
		});
		if (asset === "forbidden")
			throw new MediaError(403, "Your editing access has changed.");
		if (asset === "full")
			throw new MediaError(
				409,
				"This project has reached its media limit (100 files or 100 MB).",
			);
		if (asset === "deleting")
			throw new MediaError(
				409,
				"This file is being removed. Wait, then upload it again.",
			);
		// Repeating the same upload safely resumes interrupted writes. No deletion on
		// uncertain completion: the database may have committed before the response failed.
		await storage.put(objectKey(asset), file.bytes, file.mimeType);
		if (file.writeId) await store.finishWrite(file.writeId);
		return publicAssetSchema.parse(asset);
	}
	return {
		authorize,
		async list(actorId: string, projectId: string) {
			await authorize(actorId, projectId);
			return (await store.list(projectId)).map((asset) =>
				projectAssetSchema.parse(asset),
			);
		},
		stage,
		stageSpeech,
		stageVideo,
		stageClip: (actorId: string, projectId: string, file: MediaFile) =>
			stageVideo(actorId, projectId, file, "required"),
		async upload(
			actorId: string,
			projectId: string,
			file: MediaFile,
			libraryOnly = false,
		) {
			const uploadFile = {
				...file,
				retentionReason: libraryOnly ? null : "canvas",
				writeId: libraryOnly ? crypto.randomUUID() : undefined,
			};
			const asset =
				uploadFile.mimeType === "video/mp4"
					? await stageVideo(actorId, projectId, uploadFile, "optional")
					: uploadFile.mimeType === "audio/mpeg"
						? await stageSpeech(actorId, projectId, uploadFile)
						: await stage(actorId, projectId, uploadFile);
			const completed = await store.complete(actorId, asset.id);
			if (!completed)
				throw new MediaError(403, "Your editing access has changed.");
			return publicAssetSchema.parse(completed);
		},
		async read(
			actorId: string,
			projectId: string,
			assetId: string,
			rangeHeader?: string | null,
		) {
			await authorize(actorId, projectId);
			const asset = await store.get(projectId, assetId);
			if (!asset) throw new MediaError(404, "Media not found.");
			const range = parseMediaRange(rangeHeader, asset.bytes);
			const object = await storage.get(objectKey(asset), range ?? undefined);
			if (!object) throw new MediaError(404, "Media file is unavailable.");
			return { asset: publicAssetSchema.parse(asset), object, range };
		},
	};
}
export type MediaService = ReturnType<typeof createMediaService>;
