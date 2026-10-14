import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createAuth } from "@kousa/auth";
import { createDb, closeDb } from "@kousa/db";
import { localDatabaseConfig } from "@kousa/db/config";
import { user } from "@kousa/db/schema/auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const authConfig = {
  DATABASE_MODE: "local",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "local-development-only-secret-at-least-32-characters",
  CORS_ORIGIN: "http://localhost:3001",
  POLAR_ACCESS_TOKEN: "",
  POLAR_SUCCESS_URL: "http://localhost:3001",
} satisfies Parameters<typeof createAuth>[0];

const identitySchema = z.object({ user: z.object({ email: z.string(), name: z.string() }) });

test("local auth registers and authenticates through the real Drizzle adapter without Polar", async (t) => {
  const db = createDb({
    ...localDatabaseConfig,
    DATABASE_URL: "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test",
  });
  const email = `local-${randomUUID()}@example.test`;
  t.after(async () => {
    try {
      await db.delete(user).where(eq(user.email, email));
    } finally {
      await closeDb(db);
    }
  });
  let externalCalls = 0;
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (...args: Parameters<typeof fetch>) => {
    const [input] = args;
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      externalCalls++;
      throw new Error("External network access is forbidden in local auth tests");
    }
    return fetch(...args);
  });
  const auth = createAuth(authConfig, db);
  const request = (path: string, body: unknown) =>
    auth.handler(
      new Request(`${authConfig.BETTER_AUTH_URL}/api/auth/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: authConfig.CORS_ORIGIN },
        body: JSON.stringify(body),
      }),
    );
  const signup = await request("sign-up/email", {
    email,
    name: "Local developer",
    password: "local-test-password-123",
  });
  assert.equal(signup.status, 200);
  assert.equal(identitySchema.parse(await signup.json()).user.email, email);
  const signin = await request("sign-in/email", { email, password: "local-test-password-123" });
  assert.equal(signin.status, 200);
  const cookies = signin.headers.getSetCookie();
  assert.ok(cookies.length > 0);
  assert.ok(cookies.every((cookie) => !/;\s*Secure(?:;|$)/i.test(cookie)));
  assert.ok(cookies.some((cookie) => /SameSite=Lax/i.test(cookie)));
  const session = await auth.handler(
    new Request(`${authConfig.BETTER_AUTH_URL}/api/auth/get-session`, {
      headers: { Cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; ") },
    }),
  );
  assert.equal(session.status, 200);
  assert.deepEqual(identitySchema.parse(await session.json()).user, {
    email,
    name: "Local developer",
  });
  assert.equal(externalCalls, 0);
  const invalid = await request("sign-in/email", { email, password: "wrong-password-123" });
  assert.equal(invalid.status, 401);
});
