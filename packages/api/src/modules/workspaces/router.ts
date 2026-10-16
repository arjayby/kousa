import { ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { z } from "zod";

import { protectedProcedure } from "../../index";
import {
  invitationEmailSchema,
  invitationIdSchema,
  invitationSchema,
  invitationTokenSchema,
  issuedInvitationSchema,
  memberRoleSchema,
  memberSchema,
  successSchema,
  userIdSchema,
  websiteIdSchema,
  websiteSchema,
  workspaceIdSchema,
  workspaceNameSchema,
  workspaceSchema,
} from "./contract";
import {
  acceptInvitation,
  authorizeWebsite,
  createWorkspace,
  getWorkspace,
  issueInvitation,
  leaveWorkspace,
  listInvitations,
  listMembers,
  listWorkspaces,
  removeMember,
  renameWorkspace,
  revokeInvitation,
  setMemberRole,
  transferOwnership,
  type WorkspaceError,
  type WorkspacePersistenceError,
} from "./service";

function run<A>(
  operation: Effect.Effect<A, WorkspacePersistenceError | WorkspaceError>,
  reportFailure: (cause: unknown) => void,
) {
  return Effect.runPromise(
    operation.pipe(
      Effect.catchTags({
        WorkspacePersistenceError: (error) => {
          reportFailure(error.cause);
          return Effect.fail(
            new ORPCError("INTERNAL_SERVER_ERROR", { message: "Workspace operation failed" }),
          );
        },
        WorkspaceError: (error) =>
          Effect.fail(new ORPCError(error.code, { message: error.message })),
      }),
    ),
  );
}

export const workspacesRouter = {
  list: protectedProcedure.output(z.array(workspaceSchema)).handler(({ context }) =>
    run(
      listWorkspaces({
        db: context.db,
        userId: userIdSchema.parse(context.session.user.id),
      }),
      context.reportFailure,
    ),
  ),
  create: protectedProcedure
    .input(z.object({ name: workspaceNameSchema }))
    .output(workspaceSchema)
    .handler(({ context, input }) =>
      run(
        createWorkspace({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          name: input.name,
        }),
        context.reportFailure,
      ),
    ),
  get: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdSchema }))
    .output(workspaceSchema)
    .handler(({ context, input }) =>
      run(
        getWorkspace({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          workspaceId: input.workspaceId,
        }),
        context.reportFailure,
      ),
    ),
  rename: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdSchema, name: workspaceNameSchema }))
    .output(workspaceSchema)
    .handler(({ context, input }) =>
      run(
        renameWorkspace({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          ...input,
        }),
        context.reportFailure,
      ),
    ),
  members: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdSchema }))
    .output(z.array(memberSchema))
    .handler(({ context, input }) =>
      run(
        listMembers({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          ...input,
        }),
        context.reportFailure,
      ),
    ),
  setRole: protectedProcedure
    .input(
      z.object({
        workspaceId: workspaceIdSchema,
        targetUserId: userIdSchema,
        role: memberRoleSchema,
      }),
    )
    .output(successSchema)
    .handler(({ context, input }) =>
      run(
        setMemberRole({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          ...input,
        }),
        context.reportFailure,
      ),
    ),
  removeMember: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdSchema, targetUserId: userIdSchema }))
    .output(successSchema)
    .handler(({ context, input }) =>
      run(
        removeMember({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          ...input,
        }),
        context.reportFailure,
      ),
    ),
  leave: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdSchema }))
    .output(successSchema)
    .handler(({ context, input }) =>
      run(
        leaveWorkspace({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          ...input,
        }),
        context.reportFailure,
      ),
    ),
  transferOwnership: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdSchema, targetUserId: userIdSchema }))
    .output(successSchema)
    .handler(({ context, input }) =>
      run(
        transferOwnership({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          ...input,
        }),
        context.reportFailure,
      ),
    ),
  invite: protectedProcedure
    .input(
      z.object({
        workspaceId: workspaceIdSchema,
        email: invitationEmailSchema,
        role: memberRoleSchema,
      }),
    )
    .output(issuedInvitationSchema)
    .handler(({ context, input }) =>
      run(
        issueInvitation({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          ...input,
        }),
        context.reportFailure,
      ),
    ),
  invitations: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdSchema }))
    .output(z.array(invitationSchema))
    .handler(({ context, input }) =>
      run(
        listInvitations({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          ...input,
        }),
        context.reportFailure,
      ),
    ),
  acceptInvitation: protectedProcedure
    .input(z.object({ token: invitationTokenSchema }))
    .output(workspaceSchema)
    .handler(({ context, input }) =>
      run(
        acceptInvitation({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          token: input.token,
          enabled: context.invitationAcceptanceEnabled,
        }),
        context.reportFailure,
      ),
    ),
  revokeInvitation: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdSchema, invitationId: invitationIdSchema }))
    .output(successSchema)
    .handler(({ context, input }) =>
      run(
        revokeInvitation({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          ...input,
        }),
        context.reportFailure,
      ),
    ),
  website: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdSchema, websiteId: websiteIdSchema }))
    .output(websiteSchema)
    .handler(({ context, input }) =>
      run(
        authorizeWebsite({
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          ...input,
          permission: "view",
        }),
        context.reportFailure,
      ),
    ),
};
