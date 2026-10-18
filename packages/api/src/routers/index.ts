import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { workspacesRouter } from "../modules/workspaces/router";
import { websitesRouter } from "../modules/websites/router";

export const appRouter = {
  workspaces: workspacesRouter,
  websites: websitesRouter,
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
      billingEnabled: context.billingEnabled,
    };
  }),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
