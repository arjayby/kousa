import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";
import { randomUUID } from "node:crypto";

export default {
  tests: "tests/e2e/**/*.e2e.ts",
  credentials: { disposable: { username: "temporary@example.test", password: randomUUID() } },
  targets: [
    {
      name: "chromium",
      engine: web(),
      app: {
        url: "http://127.0.0.1:0",
        command: {
          executable: "node",
          args: ["tests/e2e/start-local.mjs", "{port}"],
          env: {
            // e2e isolates child environments. Preserve pnpm's store and CI mode.
            CI: process.env.CI ?? "false",
            ...(process.env.PNPM_HOME ? { PNPM_HOME: process.env.PNPM_HOME } : {}),
          },
          log: ".e2e/logs/local-app.log",
          startupTimeout: 120000,
        },
      },
    },
  ],
} satisfies E2EConfig;
