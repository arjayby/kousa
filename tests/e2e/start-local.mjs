import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";

const webPort = Number(process.argv[2]);
if (!Number.isInteger(webPort) || webPort < 1) throw new Error("A frontend port is required");
const webOrigin = `http://127.0.0.1:${webPort}`;
const children = new Set();

function start(args, options = {}) {
  const child = spawn("pnpm", args, { stdio: "inherit", detached: true, ...options });
  children.add(child);
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    shutdown(1);
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (child.pid && child.exitCode === null) process.kill(-child.pid, "SIGTERM");
  }
  process.exit(code);
}
process.on("SIGTERM", () => shutdown());
process.on("SIGINT", () => shutdown());

async function completed(child) {
  const code = await new Promise((resolve) => child.once("exit", resolve));
  children.delete(child);
  if (code !== 0) throw new Error(`Local test dependency exited with ${code}`);
}

try {
  await completed(start(["services:up"]));
  await completed(start(["--filter", "@kousa/db", "exec", "tsx", "scripts/prepare-local-test.ts"]));
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("No API port available");
  const apiPort = address.port;
  await new Promise((resolve) => listener.close(resolve));
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const worker = start(
    [
      "--filter",
      "server",
      "exec",
      "wrangler",
      "dev",
      "--config",
      "local/wrangler.jsonc",
      "--local",
      "--port",
      String(apiPort),
      "--inspector-port",
      "0",
      "--log-level",
      "error",
      "--var",
      "DATABASE_URL:postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test",
      "--var",
      `BETTER_AUTH_URL:${apiOrigin}`,
      "--var",
      `CORS_ORIGIN:${webOrigin}`,
    ],
    {
      env: {
        ...process.env,
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
        WRANGLER_SEND_METRICS: "false",
      },
    },
  );
  const deadline = Date.now() + 60000;
  while (true) {
    if (worker.exitCode !== null || Date.now() > deadline)
      throw new Error("Local Worker failed to start");
    try {
      const response = await fetch(apiOrigin, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.text()) === "OK") break;
    } catch {
      /* Retry the readiness probe while Wrangler starts. */
    }
    await setTimeout(150);
  }
  const web = start(
    [
      "--filter",
      "web",
      "run",
      "dev:bare",
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      env: { ...process.env, VITE_SERVER_URL: apiOrigin, KOUSA_E2E_API_URL: apiOrigin },
    },
  );
  await completed(web);
  shutdown();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Local browser test startup failed"}\n`,
  );
  shutdown(1);
}
