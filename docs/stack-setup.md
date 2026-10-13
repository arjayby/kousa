# Stack setup status

The scaffold contains React, Vite, TanStack Router, TanStack Query, Hono, oRPC, Better Auth, Polar, Evlog, Drizzle, and Alchemy deployment configuration.

The additional dependencies are installed in the packages that can consume them:

| Dependency               | Packages                    | Integration status                                                                                      |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| Effect 4                 | API, server, infrastructure | Alchemy uses Effect. Application services still need implementation.                                    |
| `@clickhouse/client-web` | API, server                 | Installed for Workers-compatible HTTP access. No database or tables provisioned.                        |
| Recharts                 | Web, UI                     | Installed. Chart components and dashboards still need implementation.                                   |
| `pg` and `@types/pg`     | Database                    | Installed. The database factory still uses Neon HTTP.                                                   |
| `@shadcn/lint`           | Root development tooling    | Integrated with Oxlint to require statically readable classes on shared UI components in frontend code. |

`pnpm run lint` checks code. `pnpm run format:check` checks formatting. `pnpm run format` rewrites formatting. `pnpm run check` runs both checks without rewriting files.

The generated server environment file uses a triple-slash declaration reference. Its lint override preserves that generated syntax. Other TypeScript files retain the default rule.

## Local services

`compose.local.yaml` defines PostgreSQL and ClickHouse containers for OrbStack. Ports bind to localhost and volumes persist data. The credentials below are local development defaults.

| Service    | Connection                                                                      |
| ---------- | ------------------------------------------------------------------------------- |
| PostgreSQL | `postgresql://kousa:kousa_local@localhost:5432/kousa`                           |
| ClickHouse | `http://localhost:8123`, database `kousa`, user `kousa`, password `kousa_local` |

Start OrbStack before running `pnpm run services:up`. Use `pnpm run services:down` to stop containers without deleting volumes. Use `pnpm run services:logs` to inspect logs.

Starting the containers does not connect the app to them. The generated Neon HTTP driver cannot use local PostgreSQL directly. Database adaptation is the next integration task.

## Pending integrations

- Adapt the database factory and request lifecycle to `pg`, with local PostgreSQL for development and Neon through Hyperdrive for production.
- Configure Alchemy's local environment so development does not provision or connect to the managed production database. The generated infrastructure currently declares a Neon project.
- Add Cloudflare Queue bindings and an Effect-based consumer with explicit event IDs, acknowledgement, and retry handling.
- Add ClickHouse configuration, event tables, and an ingestion client. Keep credentials server-side.
- Build the browser tracking SDK and define its event contract.
- Add chart components through the existing shared UI package.
- Connect the Polar sandbox and verify webhook processing before enabling subscriptions.

Cloudflare Queues and Hyperdrive are infrastructure resources. Their provisioning is separate from installing JavaScript dependencies. No cloud deployment or resource provisioning ran during dependency setup.
