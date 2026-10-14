import type { Context as ApiContext } from "@kousa/api/context";
import type { Context as HonoContext } from "hono";

import type { ServerEnvironment } from "./services";

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
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
