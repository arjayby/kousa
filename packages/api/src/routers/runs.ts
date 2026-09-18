import { GenerationError } from "@kousa/generation/input";
import {
	runHistoryInput,
	runReferenceInput,
} from "@kousa/generation/run-contracts";
import { createRuns } from "@kousa/generation/run-runtime";
import type { RunService } from "@kousa/generation/run-service";
import { ProjectError } from "@kousa/projects/service";
import { ORPCError } from "@orpc/server";
import { protectedProcedure } from "../index";

export function createRunRouter(service: () => RunService = createRuns) {
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
		history: procedure
			.input(runHistoryInput)
			.handler(({ context, input }) =>
				service().history(context.session.user.id, input),
			),
		detail: procedure
			.input(runReferenceInput)
			.handler(({ context, input }) =>
				service().detail(context.session.user.id, input),
			),
		cancel: procedure
			.input(runReferenceInput)
			.handler(({ context, input }) =>
				service().cancel(context.session.user.id, input),
			),
	};
}
