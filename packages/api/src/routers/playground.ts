import { GenerationError } from "@kousa/generation/input";
import {
	playgroundGenerateInput,
	playgroundHistoryInput,
	playgroundImportInput,
} from "@kousa/generation/playground-contracts";
import { createPlayground } from "@kousa/generation/playground-runtime";
import type { PlaygroundService } from "@kousa/generation/playground-service";
import { MediaError } from "@kousa/media/service";
import { ProjectError } from "@kousa/projects/service";
import { ORPCError } from "@orpc/server";
import { protectedProcedure } from "../index";

export function createPlaygroundRouter(
	service: () => PlaygroundService = createPlayground,
) {
	const procedure = protectedProcedure.use(async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			if (error instanceof GenerationError)
				throw new ORPCError(error.code, { message: error.message });
			if (error instanceof ProjectError)
				throw new ORPCError(error.code, {
					message: "This project is unavailable.",
				});
			if (error instanceof MediaError)
				throw new ORPCError(
					error.status === 403 ? "FORBIDDEN" : "BAD_REQUEST",
					{ message: error.message },
				);
			throw error;
		}
	});
	return {
		history: procedure
			.input(playgroundHistoryInput)
			.handler(({ context, input }) =>
				service().history(context.session.user.id, input),
			),
		generate: procedure
			.input(playgroundGenerateInput)
			.handler(({ context, input }) =>
				service().generate(context.session.user.id, input),
			),
		importToCanvas: procedure
			.input(playgroundImportInput)
			.handler(({ context, input }) =>
				service().importToCanvas(context.session.user.id, input),
			),
	};
}
