import {
	clipPreviewInput,
	clipProjectInput,
	clipStartInput,
} from "@kousa/media/clip-contracts";
import { createClips } from "@kousa/media/clip-runtime";
import { ClipError, type ClipService } from "@kousa/media/clip-service";
import { ProjectError } from "@kousa/projects/service";
import { ORPCError } from "@orpc/server";
import { protectedProcedure } from "../index";
export function createClipRouter(service: () => ClipService = createClips) {
	const procedure = protectedProcedure.use(async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			if (error instanceof ClipError)
				throw new ORPCError(error.code, { message: error.message });
			if (error instanceof ProjectError)
				throw new ORPCError(
					error.code === "FORBIDDEN" ? "FORBIDDEN" : "NOT_FOUND",
					{ message: "Project is unavailable." },
				);
			throw error;
		}
	});
	return {
		list: procedure
			.input(clipProjectInput)
			.handler(({ context, input }) =>
				service().list(context.session.user.id, input),
			),
		preview: procedure
			.input(clipPreviewInput)
			.handler(({ context, input }) =>
				service().preview(context.session.user.id, input),
			),
		start: procedure
			.input(clipStartInput)
			.handler(({ context, input }) =>
				service().start(context.session.user.id, input),
			),
	};
}
