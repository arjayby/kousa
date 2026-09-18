import { createMediaGallery } from "@kousa/media/gallery";
import { mediaGalleryInput } from "@kousa/media/gallery-contracts";
import { protectedProcedure } from "../index";

export function createMediaRouter(service = createMediaGallery) {
	return {
		list: protectedProcedure
			.input(mediaGalleryInput)
			.handler(({ context, input }) =>
				service().list(context.session.user.id, input),
			),
	};
}
