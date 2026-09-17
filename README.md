# kousa

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Self, ORPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Polar sandbox billing** - Verified payments grant credits once per order
- **Projects and permissions** - Private projects with owner, editor, and viewer access through email invitations
- **Background generation** - Durable Cloudflare Workflows for text/image/video/speech jobs, shared progress, recovery, and protected credit reservations
- **Node canvas** - Text, image, video, and speech nodes with connections, undo/redo, and shared project saving with editor/viewer permissions
- **Project media library** - Search and filter saved media, preview and download files, and reuse images on the canvas
- **Resend email** - Expiring invitations bound to a verified email, with roles and invitation status
- **Biome** - Linting and formatting
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

Alchemy provisions Neon, passes its connection credentials directly to the deployed application, and manages database deployment in the same stack as the consuming app. You do not need to copy a hosted `DATABASE_URL` into the app environment.

Generate and commit migration SQL with `pnpm run db:generate`. Alchemy runs the database package's `db:migrate:deploy` command with Neon's direct connection after provisioning, then supplies the pooled connection to the app. This uses the scaffold's Drizzle 0.x migration format and migration history; Alchemy's built-in migration runner requires Drizzle 1.x.

Sandbox credit purchases and webhook setup are documented in [packages/billing/README.md](packages/billing/README.md). The $5 test pack grants 500 credits after a verified `order.paid` delivery. Add `POLAR_WEBHOOK_SECRET` to `apps/web/.env` when connecting a Polar endpoint or local listener.

Project creation and access rules are documented in [packages/projects/README.md](packages/projects/README.md). Configure the sending domain and local email credentials using [packages/email/README.md](packages/email/README.md). Without email configuration, invitations are saved with a **Not sent** status.

Then, run the development server:

```bash
pnpm run dev
```

Alchemy starts Next.js and the local generation Worker, applies migrations, and supplies the existing Gateway key to both. No new environment variables are needed. See [background generation](docs/background-generation.md) for local persistence, recovery, and deployment.

Open [http://localhost:3001](http://localhost:3001) in your browser to see the fullstack application.

## UI Customization

Connected text, image, video, and speech workflows are documented in [Run to this node](docs/graph-execution.md).

Open **Media library** in the canvas toolbar to browse project files. See [project media](docs/project-media.md) for supported formats, access rules, and local storage.

Generation setup and billing behavior are documented in [Text generation](docs/text-generation.md), [Image generation](docs/image-generation.md), [Speech generation](docs/speech-generation.md), and [Video generation](docs/video-generation.md).

Completed checks and deferred speech/video provider tests are tracked in the [verification summary](docs/verification.md).

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@kousa/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Deployment

### Alchemy

- Target: web on Cloudflare
- Configure provider login: `cd packages/infra && pnpm exec alchemy login --configure`
- Dev: pnpm run dev
- Deploy: pnpm run deploy
- Destroy: pnpm run destroy

`alchemy login --configure` stores the selected Cloudflare, Neon, PlanetScale, and/or Prisma provider profiles under `~/.alchemy`; no provider-specific setup command is required by this scaffold.

Deploys are staged and default to a personal `dev_<username>` stage. For production, run the deploy with an explicit stage from `packages/infra`:

```bash
cd packages/infra && pnpm exec alchemy deploy --stage production
```

The web package supplies Next.js's optional `critters` dependency through the maintained [Beasties fork](https://github.com/danielroe/beasties). OpenNext needs to resolve that module when bundling the current Next.js runtime, even with critical CSS optimization disabled.

For a packaging check without deployment, stop the development server and run:

```bash
DATABASE_URL=postgresql://build:build@127.0.0.1:9/kousa pnpm --filter web build:cloudflare
```

This placeholder lets Next.js construct the database client while determining which pages require a request. The build does not query the database. Alchemy supplies the real connection at runtime; never use this placeholder to run the application.

## Git Hooks and Formatting

- Run checks: `pnpm run check`

## Project Structure

```
kousa/
├── apps/
│   ├── web/         # Fullstack application (Next.js)
│   └── jobs/        # Private Cloudflare Worker, Workflows and recovery schedule
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   ├── billing/     # Credit pack catalog, fulfillment, and webhook verification
│   ├── generation/  # AI Gateway text/image/video/speech generation and credit reservations
│   ├── media/       # Private project image/audio storage, validation, and upload routes
│   ├── email/       # Resend email transport and invitation/verification templates
│   ├── projects/    # Project contracts, permissions, and invitation service
│   └── db/          # Database schema & queries
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm test`: Run billing, project, generation, and media tests against isolated Postgres engines, plus email transport tests
- `pnpm run db:push`: Push schema changes to database
- `pnpm run db:generate`: Generate SQL migrations from the Drizzle schema
- `pnpm run db:migrate`: Run database migrations
- `pnpm run db:studio`: Open database studio UI
- `pnpm run check`: Run Biome formatting and linting

Image nodes support private project uploads through Cloudflare R2. Local development uses persistent local storage and requires no additional API keys. See [project media setup](docs/project-media.md) for permissions, limits, and production R2 activation.
