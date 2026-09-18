import { createDb } from "@kousa/db";
import {
	createMediaGalleryStore,
	type MediaGalleryStore,
} from "@kousa/db/media-gallery-store";
import {
	type GalleryInput,
	type GalleryPage,
	galleryAssetSchema,
	mediaGalleryInput,
} from "./gallery-contracts";

export function createMediaGalleryService(store: MediaGalleryStore) {
	return {
		async list(actorId: string, raw: GalleryInput = {}): Promise<GalleryPage> {
			const input = mediaGalleryInput.parse(raw);
			const rows = await store.list(actorId, input);
			const assets = rows
				.slice(0, input.limit)
				.map((row) => galleryAssetSchema.parse(row));
			const last = assets.at(-1);
			return {
				assets,
				nextCursor:
					rows.length > input.limit && last
						? { createdAt: last.createdAt, id: last.id }
						: null,
			};
		},
	};
}

export function createMediaGallery() {
	return createMediaGalleryService(createMediaGalleryStore(createDb()));
}
