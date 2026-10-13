import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

export default {
  tests: "tests/e2e/**/*.e2e.ts",
  targets: [
    {
      name: "chromium",
      engine: web(),
      app: {
        url: "http://127.0.0.1:0",
        command: {
          executable: "pnpm",
          args: [
            "--filter",
            "web",
            "run",
            "dev:bare",
            "--host",
            "127.0.0.1",
            "--port",
            "{port}",
            "--strictPort",
          ],
          env: { VITE_SERVER_URL: "http://127.0.0.1:9" },
          log: ".e2e/logs/web.log",
        },
      },
    },
  ],
} satisfies E2EConfig;
