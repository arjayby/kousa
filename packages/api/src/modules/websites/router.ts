import { ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { z } from "zod";

import { protectedProcedure } from "../../index";
import { userIdSchema, websiteIdSchema, workspaceIdSchema } from "../workspaces/contract";
import type { WorkspaceError, WorkspacePersistenceError } from "../workspaces/service";
import { installationSchema, websiteFieldsSchema, websiteSettingsSchema } from "./contract";
import {
  createWebsite,
  getWebsite,
  listWebsites,
  updateWebsite,
  websiteInstallation,
} from "./service";

function run<A>(
  operation: Effect.Effect<A, WorkspaceError | WorkspacePersistenceError>,
  reportFailure: (cause: unknown) => void,
) {
  return Effect.runPromise(
    operation.pipe(
      Effect.catchTags({
        WorkspaceError: (error) =>
          Effect.fail(new ORPCError(error.code, { message: error.message })),
        WorkspacePersistenceError: (error) => {
          reportFailure(error.cause);
          return Effect.fail(
            new ORPCError("INTERNAL_SERVER_ERROR", { message: "Website operation failed" }),
          );
        },
      }),
    ),
  );
}

const workspaceInput = z.object({ workspaceId: workspaceIdSchema });
export const websitesRouter = {
  list: protectedProcedure
    .input(workspaceInput)
    .output(websiteSettingsSchema.array())
    .handler(({ context, input }) =>
      run(
        listWebsites({
          ...input,
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
        }),
        context.reportFailure,
      ),
    ),
  create: protectedProcedure
    .input(workspaceInput.extend(websiteFieldsSchema.shape))
    .output(websiteSettingsSchema)
    .handler(({ context, input }) =>
      run(
        createWebsite({
          ...input,
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
        }),
        context.reportFailure,
      ),
    ),
  get: protectedProcedure
    .input(workspaceInput.extend({ websiteId: websiteIdSchema }))
    .output(websiteSettingsSchema)
    .handler(({ context, input }) =>
      run(
        getWebsite({
          ...input,
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
        }),
        context.reportFailure,
      ),
    ),
  update: protectedProcedure
    .input(workspaceInput.extend({ websiteId: websiteIdSchema, ...websiteFieldsSchema.shape }))
    .output(websiteSettingsSchema)
    .handler(({ context, input }) =>
      run(
        updateWebsite({
          ...input,
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
        }),
        context.reportFailure,
      ),
    ),
  installation: protectedProcedure
    .input(workspaceInput.extend({ websiteId: websiteIdSchema }))
    .output(installationSchema)
    .handler(({ context, input }) =>
      run(
        websiteInstallation({
          ...input,
          db: context.db,
          userId: userIdSchema.parse(context.session.user.id),
          trackingScript: context.trackingScript,
        }),
        context.reportFailure,
      ),
    ),
};
