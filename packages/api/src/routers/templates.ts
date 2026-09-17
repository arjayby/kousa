import { ProjectError } from "@kousa/projects/service";
import {
	renameTemplateInput,
	saveTemplateInput,
	templateIdInput,
	templateProjectInput,
} from "@kousa/projects/template-contracts";
import { createTemplates } from "@kousa/projects/template-runtime";
import { TemplateError, type TemplateService } from "@kousa/projects/templates";
import { ORPCError } from "@orpc/server";
import { protectedProcedure } from "../index";

export function createTemplatesRouter(
	service: () => TemplateService = createTemplates,
) {
	const procedure = protectedProcedure.use(async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			if (error instanceof TemplateError)
				throw new ORPCError(error.code, { message: error.message });
			if (error instanceof ProjectError)
				throw new ORPCError(
					error.code === "SERVICE_UNAVAILABLE"
						? "SERVICE_UNAVAILABLE"
						: error.code === "FORBIDDEN"
							? "FORBIDDEN"
							: "NOT_FOUND",
					{ message: error.message },
				);
			throw error;
		}
	});
	return {
		list: procedure.handler(({ context }) =>
			service().list(context.session.user.id),
		),
		save: procedure
			.input(saveTemplateInput)
			.handler(({ context, input }) =>
				service().save(context.session.user.id, input),
			),
		rename: procedure
			.input(renameTemplateInput)
			.handler(({ context, input }) =>
				service().rename(context.session.user.id, input),
			),
		remove: procedure
			.input(templateIdInput)
			.handler(({ context, input }) =>
				service().remove(context.session.user.id, input),
			),
		createProject: procedure
			.input(templateProjectInput)
			.handler(({ context, input }) =>
				service().createProject(context.session.user.id, input),
			),
	};
}
