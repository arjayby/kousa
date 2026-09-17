import type { ArtifactStore } from "@kousa/generation/runner";
import { z } from "zod";

const textResult = z.object({
	kind: z.literal("text"),
	output: z.string().min(1).max(50_000),
	inputTokens: z.number().nullable(),
	outputTokens: z.number().nullable(),
});
export function r2Artifacts(bucket: R2Bucket): ArtifactStore {
	const key = (id: string) => `generation-results/${id}`;
	return {
		async get(id) {
			const object = await bucket.get(key(id));
			if (!object) return null;
			if (object.customMetadata?.kind === "text")
				return textResult.parse(await object.json());
			if (
				(object.customMetadata?.kind !== "image" &&
					object.customMetadata?.kind !== "speech" &&
					object.customMetadata?.kind !== "video") ||
				object.size >
					(object.customMetadata?.kind === "video" ? 20 : 10) * 1024 * 1024
			)
				throw new Error("Invalid stored generation result");
			return {
				kind: object.customMetadata.kind,
				bytes: new Uint8Array(await object.arrayBuffer()),
				mimeType:
					object.httpMetadata?.contentType ?? "application/octet-stream",
			};
		},
		async put(id, result) {
			await bucket.put(
				key(id),
				result.kind === "text" ? JSON.stringify(result) : result.bytes,
				{
					customMetadata: { kind: result.kind },
					httpMetadata: {
						contentType:
							result.kind === "text" ? "application/json" : result.mimeType,
						cacheControl: "private, no-store",
					},
				},
			);
		},
		async delete(id) {
			await bucket.delete(key(id));
		},
	};
}
