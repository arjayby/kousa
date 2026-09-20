import { chatRequest, chatScope } from "@kousa/generation/canvas-chat";
import { createCanvasChat } from "@kousa/generation/canvas-chat-runtime";
import type { CanvasChatService } from "@kousa/generation/canvas-chat-service";
import { GenerationError } from "@kousa/generation/input";
import { ProjectError } from "@kousa/projects/service";
import { ORPCError } from "@orpc/server";
import { protectedProcedure } from "../index";

export function createCanvasChatRouter(
	service: () => CanvasChatService = createCanvasChat,
) {
	const procedure = protectedProcedure.use(async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			if (error instanceof GenerationError)
				throw new ORPCError(error.code, { message: error.message });
			if (error instanceof ProjectError)
				throw new ORPCError(error.code, {
					message: "This canvas is unavailable.",
				});
			throw error;
		}
	});
	return {
		history: procedure
			.input(chatScope)
			.handler(({ context, input }) =>
				service().history(context.session.user.id, input),
			),
		compose: procedure
			.input(chatRequest)
			.handler(({ context, input }) =>
				service().compose(context.session.user.id, input),
			),
	};
}
