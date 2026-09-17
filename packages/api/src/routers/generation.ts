import {
	generateInput,
	listGenerationsInput,
} from "@kousa/generation/contracts";
import { GenerationError } from "@kousa/generation/input";
import { createGeneration } from "@kousa/generation/runtime";
import type { GenerationService } from "@kousa/generation/service";
import { ProjectError } from "@kousa/projects/service";
import { ORPCError } from "@orpc/server";
import { protectedProcedure } from "../index";

export function createGenerationRouter(
	service: () => GenerationService = createGeneration,
) {
	const procedure = protectedProcedure.use(async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			if (error instanceof GenerationError)
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
			.input(listGenerationsInput)
			.handler(({ context, input }) =>
				service().list(context.session.user.id, input),
			),
		generate: procedure
			.input(generateInput)
			.handler(({ context, input }) =>
				service().generate(context.session.user.id, input),
			),
	};
}
