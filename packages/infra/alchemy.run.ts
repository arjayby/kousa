import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
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
	const database = yield* Neon.Project("database");
	const migration = yield* Command.Exec("database-migrate", {
		command: "pnpm run db:migrate:deploy",
		cwd: "../db",
		env: {
			DATABASE_URL: database.connectionUri.pipe(Output.map(Redacted.make)),
		},
		memo: {
			include: ["src/migrations/**", "drizzle.config.ts", "package.json"],
			lockfile: true,
		},
	});
	// Wait for Drizzle's migration runner before exposing the database to the app.
	const runtimeUrl = Output.all(
		database.pooledConnectionUri,
		migration.hash,
	).pipe(Output.map(([url]) => Redacted.make(url)));

	return {
		runtimeEnv: { DATABASE_URL: runtimeUrl },
	};
});

export const databaseEnv = managedDatabase.pipe(
	Effect.map(({ runtimeEnv }) => runtimeEnv),
);

export const databaseProviders = Layer.mergeAll(Neon.providers());

export const web = Cloudflare.Website.StaticSite(
	"web",
	Effect.gen(function* () {
		// Resolve the resource declaration before StaticSite serializes subprocess env.
		const databaseBindings = yield* databaseEnv;
		const media = yield* Cloudflare.R2.Bucket("media", {
			publicAccess: false,
			forceDestroy: false,
		});
		const emailFrom = yield* Config.string("EMAIL_FROM").pipe(
			Config.withDefault("invites@mail.kousa.app"),
			Effect.orDie,
		);

		return {
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
				MEDIA: media,
				AI_GATEWAY_API_KEY: Config.redacted("AI_GATEWAY_API_KEY").pipe(
					Config.withDefault(Redacted.make("")),
				),
				LIVEBLOCKS_SECRET_KEY: Config.redacted("LIVEBLOCKS_SECRET_KEY").pipe(
					Config.withDefault(Redacted.make("")),
				),
				EMAIL_FROM: emailFrom,
				RESEND_API_KEY: Config.redacted("RESEND_API_KEY").pipe(
					Config.withDefault(Redacted.make("")),
				),
				IMAGES: Cloudflare.Images.Images(),
				...databaseBindings,
				BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
				BETTER_AUTH_URL: Cloudflare.Worker.URL,
				POLAR_ACCESS_TOKEN: Config.redacted("POLAR_ACCESS_TOKEN"),
				POLAR_WEBHOOK_SECRET: Config.redacted("POLAR_WEBHOOK_SECRET").pipe(
					Config.withDefault(Redacted.make("")),
				),
				POLAR_SUCCESS_URL: Config.string("POLAR_SUCCESS_URL"),
			},
			dev: {
				command: "pnpm run dev:bare",
				url: "http://localhost:3001",
			},
		};
	}),
);

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
