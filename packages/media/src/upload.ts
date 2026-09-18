import {
	imageMimeTypes,
	maxAudioBytes,
	maxImageBytes,
	maxVideoBytes,
	mediaLifecycleHeaders,
	mediaUploadSchema,
	mediaUrl,
} from "./contracts";

export const uploadAccept = [...imageMimeTypes, "audio/mpeg", "video/mp4"].join(
	",",
);
export const uploadFormats =
	"PNG, JPEG, WebP or MP3 up to 10 MB; H.264 MP4 up to 20 MB";

export function uploadFileError(file: { type: string; size: number }) {
	if (!file.size) return "This file is empty. Choose a file with content.";
	const limit =
		file.type === "video/mp4"
			? maxVideoBytes
			: file.type === "audio/mpeg"
				? maxAudioBytes
				: imageMimeTypes.some((mime) => mime === file.type)
					? maxImageBytes
					: null;
	if (!limit) return `Unsupported file type. Choose ${uploadFormats}.`;
	if (file.size > limit)
		return `This file exceeds the ${limit / 1024 / 1024} MB limit. Choose a smaller file.`;
	return null;
}

/** Use the same authenticated, validated and deduplicated path for every upload UI. */
export async function uploadProjectMedia(
	projectId: string,
	file: File,
	signal?: AbortSignal,
	libraryOnly = false,
) {
	const error = uploadFileError(file);
	if (error) throw new Error(error);
	let response: Response;
	try {
		response = await fetch(mediaUrl(projectId), {
			method: "POST",
			headers: {
				...(libraryOnly
					? { ...mediaLifecycleHeaders, "X-Kousa-Library-Only": "1" }
					: {}),
				"Content-Type": file.type,
				"X-File-Name": encodeURIComponent(file.name),
			},
			body: file,
			signal,
		});
	} catch {
		throw new Error(
			"Upload interrupted. Check your connection, then retry the same file. It may already be saved in Media library.",
		);
	}
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		const message =
			body &&
			typeof body === "object" &&
			"message" in body &&
			typeof body.message === "string"
				? body.message
				: "Could not upload this file.";
		throw new Error(
			response.status >= 500
				? `${message} Retry the same file to check whether it was saved.`
				: message,
		);
	}
	const parsed = mediaUploadSchema.safeParse(body);
	if (!parsed.success)
		throw new Error(
			"Could not confirm the upload. Retry the same file, or check Media library before uploading again.",
		);
	return parsed.data.asset;
}

export async function retainProjectMedia(projectId: string, assetId: string) {
	const response = await fetch(mediaUrl(projectId, assetId), {
		method: "POST",
	});
	if (!response.ok) {
		const body = await response.json().catch(() => null);
		throw new Error(
			(body &&
			typeof body === "object" &&
			"message" in body &&
			typeof body.message === "string"
				? body.message
				: null) ??
				"Could not confirm this file is available. Refresh Media library and try again.",
		);
	}
}
