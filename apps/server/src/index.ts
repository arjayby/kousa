import { closeDb } from "@kousa/db";
import { appRouter } from "@kousa/api/routers/index";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { initLogger } from "evlog";
import { createAuthMiddleware } from "evlog/better-auth";
import { evlog } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createContext } from "./context";
import { ENV } from "./env.server";
import { createRequestServices, type ServerEnvironment } from "./services";

initLogger({
  env: { service: "kousa-server" },
});

const app = new Hono<ServerEnvironment>();

app.use(evlog());
app.use("*", async (c, next) => {
  const { db, auth } = await createRequestServices();
  c.set("db", db);
  c.set("auth", auth);
  try {
    const identifyUser = createAuthMiddleware(auth, {
      exclude: ["/api/auth/**"],
      maskEmail: true,
    });
    await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
    await next();
  } finally {
    await closeDb(db);
  }
});

app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use("*", async (c, next) => {
  const path = c.req.path;
  const isApi = path.startsWith("/rpc/") || path.startsWith("/api-reference/");
  const writes = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  if (isApi && writes) {
    const origin = c.req.header("Origin");
    const trusted = [ENV.CORS_ORIGIN, new URL(ENV.BETTER_AUTH_URL).origin];
    if ((origin && !trusted.includes(origin)) || (!origin && c.req.header("Cookie"))) {
      return c.json(
        { defined: false, code: "FORBIDDEN", status: 403, message: "Untrusted request origin" },
        403,
      );
    }
  }
  await next();
});

app.on(["POST", "GET"], "/api/auth/*", async (c) => c.get("auth").handler(c.req.raw));

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
