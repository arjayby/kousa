// Provider-neutral boundary: graph nodes store asset IDs, never provider URLs.
export interface MediaStorage {
	put(
		key: string,
		bytes: Uint8Array<ArrayBuffer>,
		mimeType: string,
	): Promise<void>;
	get(key: string): Promise<{ body: ReadableStream; bytes: number } | null>;
}
export function r2Storage(bucket: R2Bucket): MediaStorage {
	return {
		async put(key, bytes, mimeType) {
			await bucket.put(key, bytes, {
				httpMetadata: {
					contentType: mimeType,
					cacheControl: "private, no-store",
				},
			});
		},
		async get(key) {
			const object = await bucket.get(key);
			return object
				? { body: object.body as ReadableStream, bytes: object.size }
				: null;
		},
	};
}
