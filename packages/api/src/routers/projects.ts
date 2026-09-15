import {
	changeMemberInput,
	createInviteInput,
	createProjectInput,
	inviteTokenInput,
	listProjectsInput,
	memberInput,
	projectIdInput,
	renameProjectInput,
	revokeInviteInput,
} from "@kousa/projects/contracts";
import { createProjects } from "@kousa/projects/runtime";
import { ProjectError, type ProjectService } from "@kousa/projects/service";
import { ORPCError } from "@orpc/server";
import { protectedProcedure } from "../index";

// Injection lets integration tests exercise the real auth and validation middleware.
export function createProjectsRouter(
	service: () => ProjectService = createProjects,
) {
	const procedure = protectedProcedure.use(async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			if (error instanceof ProjectError)
				throw new ORPCError(
					error.code === "INVALID_INVITE" ? "NOT_FOUND" : error.code,
					{ message: error.message },
				);
			throw error;
		}
	});
	return {
		list: procedure
			.input(listProjectsInput)
			.handler(({ context, input }) =>
				service().list(context.session.user.id, input),
			),
		create: procedure
			.input(createProjectInput)
			.handler(({ context, input }) =>
				service().create(context.session.user.id, input),
			),
		get: procedure
			.input(projectIdInput)
			.handler(({ context, input }) =>
				service().get(context.session.user.id, input),
			),
		rename: procedure
			.input(renameProjectInput)
			.handler(({ context, input }) =>
				service().rename(context.session.user.id, input),
			),
		access: procedure
			.input(projectIdInput)
			.handler(({ context, input }) =>
				service().access(context.session.user.id, input),
			),
		changeMember: procedure
			.input(changeMemberInput)
			.handler(({ context, input }) =>
				service().changeMember(context.session.user.id, input),
			),
		removeMember: procedure
			.input(memberInput)
			.handler(({ context, input }) =>
				service().removeMember(context.session.user.id, input),
			),
		createInvite: procedure
			.input(createInviteInput)
			.handler(({ context, input }) =>
				service().createInvite(context.session.user.id, input),
			),
		revokeInvite: procedure
			.input(revokeInviteInput)
			.handler(({ context, input }) =>
				service().revokeInvite(context.session.user.id, input),
			),
		previewInvite: procedure
			.input(inviteTokenInput)
			.handler(({ input }) => service().previewInvite(input)),
		acceptInvite: procedure
			.input(inviteTokenInput)
			.handler(({ context, input }) =>
				service().acceptInvite(context.session.user.id, input),
			),
	};
}
