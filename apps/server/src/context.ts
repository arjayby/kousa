import type { Context as ApiContext } from "@kousa/api/context";
import type { Context as HonoContext } from "hono";

import type { ServerEnvironment } from "./services";
import { ENV } from "./env.server";

export type CreateContextOptions = {
  context: HonoContext<ServerEnvironment>;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const db = context.get("db");
  const session = await context.get("auth").api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    db,
    session,
    invitationAcceptanceEnabled: ENV.DATABASE_MODE === "local",
    billingEnabled: ENV.DATABASE_MODE !== "local",
    reportFailure: (cause) => {
      context.get("log").set({
        workspaceFailure: { type: cause instanceof Error ? cause.name : "UnknownFailure" },
      });
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
