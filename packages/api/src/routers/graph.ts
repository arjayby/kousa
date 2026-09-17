import {
	graphPreviewInput,
	graphProjectInput,
	graphStartInput,
} from "@kousa/generation/graph-plan";
import { createGraphs } from "@kousa/generation/graph-runtime";
import type { GraphService } from "@kousa/generation/graph-service";
import { GenerationError } from "@kousa/generation/input";
import { ProjectError } from "@kousa/projects/service";
import { ORPCError } from "@orpc/server";
import { protectedProcedure } from "../index";

export function createGraphRouter(service: () => GraphService = createGraphs) {
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
			.input(graphProjectInput)
			.handler(({ context, input }) =>
				service().list(context.session.user.id, input),
			),
		preview: procedure
			.input(graphPreviewInput)
			.handler(({ context, input }) =>
				service().preview(context.session.user.id, input),
			),
		start: procedure
			.input(graphStartInput)
			.handler(({ context, input }) =>
				service().start(context.session.user.id, input),
			),
	};
}
