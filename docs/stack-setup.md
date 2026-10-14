# Run Kousa locally

Run the Vite frontend and Hono backend against PostgreSQL and ClickHouse in OrbStack. Local startup uses Wrangler's Workers runtime. It does not evaluate the Alchemy deployment stack or require cloud credentials.

## Start the application

1. Start OrbStack.
2. Install the workspace dependencies with `pnpm install`.
3. Start the databases and wait for their health checks.

   ```sh
   pnpm services:up
   ```

4. Apply the checked-in Drizzle migrations to the local development database.

   ```sh
   pnpm db:migrate:local
   ```

5. Start the backend and frontend.

   ```sh
   pnpm dev
   ```

Open [the frontend](http://localhost:3001). The backend listens at [localhost:3000](http://localhost:3000) and responds with `OK` at `/`. Use `localhost` for both browser URLs so the auth cookie uses the same host. Sign up with a development account to verify auth against PostgreSQL.

To start either app separately, run `pnpm dev:server` or `pnpm dev:web`.

## Stop and restart the databases

Run `pnpm services:down` to stop the databases. Run `pnpm services:up` to start them again. Both named volumes retain their data. Run `pnpm services:logs` to inspect database logs.

PostgreSQL exposes port 5432 and ClickHouse exposes HTTP port 8123 on `127.0.0.1` only. The database credentials in `compose.local.yaml` are development defaults. The volumes are `kousa-local_postgres-data` and `kousa-local_clickhouse-data`.

## Configure local connections

`apps/server/local/wrangler.jsonc` supplies local Worker bindings, including these development defaults:

- PostgreSQL uses `postgresql://kousa:kousa_local@127.0.0.1:5432/kousa`.
- ClickHouse uses `http://127.0.0.1:8123`, database `kousa`, username `kousa`, and password `kousa_local`.
- Better Auth uses a public development secret and `http://localhost:3000`.
- The trusted frontend origin is `http://localhost:3001`.

These values are unsuitable for deployment. Keep real credentials in ignored environment files or your deployment secret store. The server's local startup command disables Wrangler's dotenv loading. Its config directory is separate from the existing server `.env` and `.dev.vars` files. The frontend's local startup command explicitly sets `VITE_SERVER_URL=http://localhost:3000`.

`DATABASE_MODE=local` selects Drizzle's `node-postgres` driver. Local connections accept only loopback addresses, port 5432, and databases `kousa` or `kousa_test`. Query parameters are rejected. Each Worker request creates its database and auth instances and closes its pool when the request finishes.

Local auth uses HTTP cookies with `SameSite=Lax`. It disables the Polar plugin, so signup does not require a Polar token or create a remote customer. Production keeps the existing Polar sandbox integration and secure cookies.

## Generate and apply migrations

After changing the Drizzle schema, generate a migration without loading production configuration:

```sh
pnpm db:generate:local
pnpm db:migrate:local
```

`drizzle.local.config.ts` uses the local URL above. To select the isolated test database, set `LOCAL_DATABASE_URL`:

```sh
LOCAL_DATABASE_URL=postgresql://kousa:kousa_local@127.0.0.1:5432/kousa_test pnpm db:migrate:local
```

The local config rejects remote hosts and unexpected database names before Drizzle runs. The existing `db:migrate`, `db:push`, and `db:studio` commands use deployment configuration. Use the commands ending in `:local` for this workflow.

## Verify local persistence and authentication

Start the database services, then run:

```sh
pnpm test:local
pnpm test:e2e
pnpm check
pnpm check-types
```

`test:local` creates `kousa_test` if needed and applies the same migrations there. It checks SQL read/write behavior, rejects unsafe local connection settings, and verifies the production Neon HTTP transport with an external-provider stub.

The auth test uses the real Better Auth Drizzle adapter for signup, signin, session lookup, and invalid-password rejection. It blocks external network calls. The Workers integration test starts a separate local Wrangler process on an available port. It verifies signup, session lookup, and signout, and runs a ClickHouse health and read/write check inside the Worker.

Auth fixtures use unique email addresses and are deleted after each test. ClickHouse smoke checks create uniquely named Memory tables and drop them in cleanup. The smoke route exists only in the test Worker entry point. It is absent from the application entry point.

The existing auth-form browser suite supplies an anonymous session response. It covers frontend forms and navigation. The local integration suite supplies the real backend auth coverage.

## Preserve production deployment

`packages/infra/alchemy.run.ts` remains the Alchemy deployment configuration. It declares the managed Neon project and supplies `DATABASE_MODE=neon-http` with its pooled connection URI. Production retains the existing Neon HTTP driver. No production connection or migration is needed to run locally.

Hyperdrive provisioning and the production driver migration remain a separate session. ClickHouse credentials are server-side connection configuration. Analytics tables, the tracking SDK, queue ingestion, and analytics product features are also outside this setup.
