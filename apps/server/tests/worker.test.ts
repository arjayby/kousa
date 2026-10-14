import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { closeDb, createDb } from "@kousa/db";
import { user } from "@kousa/db/schema/auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

const databaseUrl = "postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test";

test(
  "local Worker serves real auth sessions and ClickHouse read/write checks",
  { timeout: 90000 },
  async (t) => {
    const listener = createServer();
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const baseURL = `http://localhost:${port}`;
    const child = spawn(
      "pnpm",
      [
        "exec",
        "wrangler",
        "dev",
        "tests/smoke.worker.ts",
        "--config",
        "local/wrangler.jsonc",
        "--local",
        "--port",
        String(port),
        "--inspector-port",
        "0",
        "--var",
        `DATABASE_URL:${databaseUrl}`,
        "--var",
        `BETTER_AUTH_URL:${baseURL}`,
        "--log-level",
        "error",
      ],
      {
        env: {
          ...process.env,
          CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
          WRANGLER_SEND_METRICS: "false",
        },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let logs = "";
    child.stdout.on("data", (data) => {
      logs += data.toString();
    });
    child.stderr.on("data", (data) => {
      logs += data.toString();
    });
    t.after(() => {
      if (child.pid && child.exitCode === null) {
        process.kill(-child.pid, "SIGTERM");
      }
    });
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null) {
        throw new Error(`Local Worker exited: ${logs}`);
      }
      try {
        const response = await fetch(baseURL, { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.text()) === "OK") {
          ready = true;
          break;
        }
      } catch {
        /* Wait for Wrangler to bind its local port. */
      }
      await setTimeout(200);
    }
    assert.ok(ready, `Local Worker did not start: ${logs}`);
    const clickhouse = await fetch(`${baseURL}/__clickhouse-smoke`);
    assert.equal(clickhouse.status, 200);
    assert.deepEqual(await clickhouse.json(), { healthy: true, rows: [{ value: 42 }] });
    const email = `worker-${randomUUID()}@example.test`;
    const db = createDb({ DATABASE_MODE: "local", DATABASE_URL: databaseUrl });
    t.after(async () => {
      try {
        await db.delete(user).where(eq(user.email, email));
      } finally {
        await closeDb(db);
      }
    });
    const post = (path: string, body: unknown, cookie = "") =>
      fetch(`${baseURL}/api/auth/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001",
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      });
    const signup = await post("sign-up/email", {
      email,
      name: "Worker developer",
      password: "local-test-password-123",
    });
    assert.equal(signup.status, 200);
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.ok(cookie);
    const session = await fetch(`${baseURL}/api/auth/get-session`, { headers: { Cookie: cookie } });
    assert.equal(session.status, 200);
    const schema = z.object({ user: z.object({ email: z.string() }) });
    assert.equal(schema.parse(await session.json()).user.email, email);
    const signout = await post("sign-out", {}, cookie);
    assert.equal(signout.status, 200);
    const revoked = await fetch(`${baseURL}/api/auth/get-session`, { headers: { Cookie: cookie } });
    assert.equal(await revoked.json(), null);
  },
);
