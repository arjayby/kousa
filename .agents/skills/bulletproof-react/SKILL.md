---
name: bulletproof-react
description: Organize and review Kousa's React frontend using Bulletproof React feature boundaries with TanStack Router, oRPC, and workspace UI components. Use when adding frontend features, deciding file placement, or refactoring imports. Does not prescribe backend architecture or authorize a repository-wide reorganization.
---

# Bulletproof React for Kousa

Inspect existing routes, package exports, and repository instructions before changing structure. Apply the patterns incrementally within the requested task.

## Feature ownership

- Keep capability-specific frontend code under `apps/web/src/features/<feature>`.
- Colocate components, query options, mutation hooks, utilities, and types with their owner. Create subfolders only when needed.
- Shared modules cannot depend on features or routes. Features consume shared modules. Routes compose features.
- Avoid imports into another feature's internals. Compose through routes, pass props or callbacks, or extract a shared contract with clear semantics.
- Prefer direct application imports. Preserve intentional workspace package exports.

Adapted from [Bulletproof React's structure guide](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md). The following choices are specific to Kousa.

## Repository placement

Keep TanStack file routes in `apps/web/src/routes`. Route modules own search validation, access gates, loaders, and screen composition. Put substantial business UI in feature screens. Do not manually edit `routeTree.gen.ts`.

Keep shared shadcn primitives and theme styles in `packages/ui`, using `@kousa/ui` exports. App-wide layouts belong in `apps/web/src/components`. Domain-specific UI stays in its feature even when several routes use it.

Possible capabilities include websites, traffic, visitors, revenue, funnels, dashboard, and billing. Billing concerns Kousa's Polar subscriptions. Revenue concerns tracked websites' payments and attribution. Do not create empty directories for these names.

## oRPC and TanStack Query

Feature `api` folders contain browser-side query options, mutation hooks, and cache behavior. Server procedures stay in `packages/api`. The shared client currently lives in `apps/web/src/utils/orpc.ts`; inspect it before importing.

Reuse the existing `orpc` utilities from `createTanstackQueryUtils`, the `client` from `createORPCClient`, and the shared query client. Use existing query and mutation options APIs instead of introducing per-feature clients or duplicate query keys. Prefetch with the router's query client when appropriate.

Use type-only imports for server client contracts such as `AppRouterClient`. Never bundle runtime server implementations, database connections, or secrets into React. Pass validated route inputs to feature screens rather than importing route modules from features.

Keep URL-shareable filters in route search parameters, server state in TanStack Query, and transient UI state local. Add a global store only for a concrete requirement.

## Backend boundary

Hono and Cloudflare entry points stay in `apps/server`; auth, database, and infrastructure stay in their existing packages. Effect belongs in backend business operations and is not a requirement for React components or the browser tracking SDK. This frontend skill does not impose a backend folder hierarchy.

## Verification

Inspect changed imports for cycles, cross-feature coupling, and browser/server leakage. Run relevant lint, type checks, and behavior tests using current package scripts. Do not reorganize untouched code solely for consistency.

When asked to enforce import boundaries, verify installed Oxlint capabilities. Do not paste upstream ESLint rules into Oxlint or add another linter without a demonstrated need.
