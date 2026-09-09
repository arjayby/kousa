import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Neon from "alchemy/Neon";
import * as Output from "alchemy/Output";
import { config } from "dotenv";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });

const managedDatabase = Effect.gen(function* () {
  const database = yield* Neon.Project("database", {
    migrations: "../../packages/db/src/migrations",
  });
  const runtimeUrl = database.pooledConnectionUri.pipe(Output.map(Redacted.make));

  return {
    runtimeEnv: { DATABASE_URL: runtimeUrl },
  };
});

export const databaseEnv = managedDatabase.pipe(Effect.map(({ runtimeEnv }) => runtimeEnv));

export const databaseBindings = {
  DATABASE_URL: databaseEnv.pipe(Effect.map(({ DATABASE_URL }) => DATABASE_URL)),
};

export const databaseProviders = Layer.mergeAll(Neon.providers());

export const web = Cloudflare.Website.StaticSite("web", {
  cwd: "../../apps/web",
  command: "pnpm run build:cloudflare",
  // Rebuild shared workspace dependencies until Alchemy has a workspace-aware default memo.
  memo: false,
  outdir: ".open-next/assets",
  main: "../../apps/web/.open-next/worker.js",
  bundle: false,
  compatibility: {
    flags: ["nodejs_compat", "global_fetch_strictly_public"],
  },
  env: {
    IMAGES: Cloudflare.Images.Images(),
    ...databaseBindings,
    BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
    POLAR_ACCESS_TOKEN: Config.redacted("POLAR_ACCESS_TOKEN"),
    POLAR_SUCCESS_URL: Config.string("POLAR_SUCCESS_URL"),
  },
  dev: {
    command: "pnpm run dev:bare",
    url: "http://localhost:3001",
  },
});

export type WebEnv = Cloudflare.InferEnv<typeof web>;

export default Alchemy.Stack(
  "kousa",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), databaseProviders),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const webWorker = yield* web;

    return {
      web: webWorker.url,
    };
  }),
);
