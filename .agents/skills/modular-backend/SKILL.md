---
name: modular-backend
description: Organize and review Kousa backend features using vertical slices, selective hexagonal boundaries, and Effect services with oRPC, Hono, and Drizzle. Use when adding backend capabilities, choosing module boundaries, or refactoring API, persistence, webhook, and queue code. Does not authorize deployment or a repository-wide reorganization.
---

# Modular backend for Kousa

Inspect current package exports, dependency versions, and repository instructions before implementation. Change only the modules needed for the requested task.

## Organize by capability

Put feature operations under `packages/api/src/modules/<capability>`. Keep files together when they change for the same business reason. Use explicit operations such as `create-website` or `calculate-attribution` as a module grows.

Start with the smallest useful structure. A module may contain a router and one service; add contracts, repositories, and domain helpers when they have distinct responsibilities. Do not create every layer or an empty directory for each planned feature.

Use these optional files within a module:

| File            | Responsibility                                              |
| --------------- | ----------------------------------------------------------- |
| `contract.ts`   | Client-safe input, output, and public error schemas         |
| `router.ts`     | oRPC procedures, access checks, and transport error mapping |
| `service.ts`    | Effect programs for feature operations and business rules   |
| `repository.ts` | Feature-specific persistence operations                     |
| `domain.ts`     | Pure calculations, named values, and business invariants    |

This is a Kousa adaptation of [Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/) and selected ideas from [Domain-Driven Hexagon](https://github.com/Sairyss/domain-driven-hexagon). Neither resource requires a repository abstraction for every query. Avoid generic base repositories, mandatory command buses, and inheritance hierarchies unless a real requirement justifies them.

## Preserve workspace responsibilities

- `packages/api` owns backend feature modules and composes their routers through the existing `src/routers/index.ts`.
- `apps/server` owns Hono middleware, HTTP entry points, webhook handlers, queue consumers, and runtime composition.
- `packages/db` owns database connections, Drizzle schemas, relations, and migrations.
- `packages/auth` owns Better Auth and its Polar integration. Keep custom subscription workflows in the billing capability without duplicating auth plugin behavior.
- `packages/infra` owns Alchemy resources and deployment wiring. Backend business modules must not import it.

Keep Kousa subscription billing separate from tracked websites' payment records and revenue attribution. Features need not match frontend folders one for one.

Business operations must not depend on Hono contexts, HTTP responses, or queue message objects. Entry points translate those objects into validated inputs and explicit service dependencies. Features may call another module's public operation when necessary; do not reach into its repository or create a dependency cycle. Move shared code only when its meaning is shared.

## Use Effect for business operations

The scaffold currently selects Effect 4. Check the manifest and lockfile before using APIs. Prefer release-matched documentation and types over examples for another major version. Keep Effect and platform packages compatible; do not change versions solely to implement a folder convention.

Represent database, ClickHouse, payment, and event-publishing dependencies as small services where that improves composition. Build implementations with Layers at the server composition boundary. Pure domain calculations need no service wrapper. Keep request identity, tenant context, and Worker bindings scoped to the request or message batch.

Compose Effect programs inside services. Execute them at entry points, using the supported oRPC integration or a version-compatible runtime bridge. Keep nested `runPromise` calls out of business operations. Adapt promise-based SDK failures into named errors at the dependency boundary.

Separate expected failures from defects. Map expected failures to documented oRPC errors or queue outcomes at entry points. Log unexpected failures without exposing stack traces, SQL, or secrets to clients. Do not turn every failure into an empty result or retry every error.

For queue consumers, webhooks, connection lifetimes, or retries, read [runtime and delivery boundaries](references/runtime-and-delivery.md).

## Contracts and access

Keep public schemas independent of server implementation imports. Preserve existing oRPC inference when sufficient. Introduce explicit contracts when a public API or independent client requires them, rather than rewriting every procedure. Reuse Zod schemas and infer types; do not introduce duplicate Effect Schema validation solely for consistency.

Authenticate at the transport boundary and enforce operation-specific authorization for every entry path. A website ID supplied by a client does not establish ownership. Carry trusted tenant context into data access and scope reads and writes accordingly. Shared operations used by queues must have an explicit trust and access model.

Expose response shapes intentionally. Do not return raw database rows when they contain fields outside the public contract. Browser code may import client-safe contracts or type-only router types, never runtime implementations.

## Verify behavior

Check dependency direction, tenant isolation, error mapping, and request lifetimes for changed code. Test business behavior at the operation boundary. Use real local database tests where available and substitute external providers through service implementations when needed. Queue and webhook changes need checks for replay, partial failure, and duplicate delivery.

Use the repository's current lint and type-check scripts. Do not install another framework, deploy infrastructure, or restructure unrelated packages as part of adopting this skill.
