# kousa

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Self, ORPC, and more.

## Features

- **Playground** - Generate without a project, switch models, revisit private history, and add saved results to a canvas without another charge

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
- **Multiple canvases** - Named canvases per project with separate graphs, collaboration, recovery, and run history; shared members and media
- **Branch copying** - Duplicate selections or copy/paste nodes with their settings and internal connections, including between projects
- **Node generation history** - Browse attempts, reuse saved outputs, and restore authored settings without starting a generation
- **Run management** - Browse canvas runs, inspect credit usage, stop unfinished work, and resume cancelled workflows
- **Project media library** - Search and filter saved media, preview and download files, and reuse images, videos, and speech on the canvas
- **Narrated clips** - Combine video and speech with timing/volume controls and durable server exports
- **Workflow templates** - Save private workflow snapshots and create fresh projects with the same prompts, models, settings, and connections
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

Alchemy starts Next.js, the local generation Worker, and the clip renderer, applies migrations, and supplies the existing Gateway key to the web and Worker. Local clip rendering requires FFmpeg and ffprobe on PATH. No new environment variables are needed. See [background generation](docs/background-generation.md) for local persistence, recovery, and deployment.

Open [http://localhost:3001](http://localhost:3001) in your browser to see the fullstack application.

Use **New canvas** in project settings or the canvas header to add a workspace, then switch between canvases in the header. See [multiple canvases](docs/multiple-canvases.md) for access, storage, and migration details.

## UI Customization

Open **Playground** to generate text, images, video, or speech without setting up a project. See [Playground](docs/playground.md) for personal history, model switching, and canvas imports.

Select nodes and use **Duplicate selection**, **Copy selection**, or **Paste nodes** in the canvas toolbar. Cmd/Ctrl+D duplicates, Cmd/Ctrl+C/V copies and pastes, and one undo removes the entire copy. See [branch copying](docs/canvas-copy-paste.md) for media rules and shortcuts.

Choose **Run affected steps** from the toolbar or a node inspector. Changed-input indicators explain outdated results; unchanged steps are reused at zero cost, with explicit force-regeneration controls. See [selective reruns](docs/selective-reruns.md) and [workflow execution](docs/graph-execution.md) for credit review, progress, and resume.

Open **Media library** in the canvas toolbar to browse project files. See [project media](docs/project-media.md) for supported formats, access rules, and local storage.

Connect Speech to a Video node’s Audio input and use **Narrated clip** to export a finished MP4. See [clip creation and renderer setup](docs/clip-composition.md). Local rendering needs no new environment variables; hosted rendering is opt-in and requires Workers Paid.

Choose **Save template** on a canvas, then open **My templates** on the dashboard to reuse, rename, or delete it. New projects keep the workflow setup and start without media files, run history, or collaborators. See [workflow templates](docs/workflow-templates.md).

Generation setup and billing behavior are documented in [Text generation](docs/text-generation.md), [Image generation](docs/image-generation.md), [Speech generation](docs/speech-generation.md), and [Video generation](docs/video-generation.md).

Open **Generation history** in a node's settings to inspect attempts, select a saved output for future work, or restore its authored settings. See [node generation history](docs/node-generation-history.md).

Open **Runs** in the canvas toolbar for the selected canvas’s run history, saved outputs, credit breakdowns, and stop controls. Queued work releases its reservation immediately; submitted requests retain theirs until they settle. See [run management](docs/run-management.md).

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
- `pnpm --filter @kousa/jobs test:renderer`: Verify actual FFmpeg timing, volumes, and MP4 output (requires FFmpeg)
- `pnpm run db:push`: Push schema changes to database
- `pnpm run db:generate`: Generate SQL migrations from the Drizzle schema
- `pnpm run db:migrate`: Run database migrations
- `pnpm run db:studio`: Open database studio UI
- `pnpm run check`: Run Biome formatting and linting

Image nodes support private project uploads through Cloudflare R2. Local development uses persistent local storage and requires no additional API keys. See [project media setup](docs/project-media.md) for permissions, limits, and production R2 activation.
