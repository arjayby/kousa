import { createAuth } from "@kousa/auth";
import { createMediaHandler } from "@kousa/media/http";
import { createMedia } from "@kousa/media/runtime";

export const handleMedia = createMediaHandler({
	async actor(request) {
		return (
			(await createAuth().api.getSession({ headers: request.headers }))?.user
				.id ?? null
		);
	},
	service: createMedia,
});
