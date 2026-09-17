# Run to this node

Select a text or image node and choose **Run to this node**. The preview lists its ancestors in execution order and the total Kousa credits. Starting reserves the full cost from the person who starts it. A new workflow regenerates every listed node. It does not reuse outputs from earlier, unrelated runs.

Supported paths include Text → Text → Image and branches that merge connected text. A shared ancestor runs once. Only the selected node and its ancestors participate, with a maximum of 20 nodes. Speech, video and image-reference connections remain outside this first version.

The canvas shows a workflow progress button and a status on each participating node. Owners, editors and viewers can see progress. Only owners and editors can start workflows. One workflow may run per project and per payer; individual generation requests wait until it finishes.

## Persistence and credits

`graph_run` stores a server-built plan with prompts, models, input hashes, dependency IDs, per-step prices and generation IDs. Starting checks the preview hash against the saved canvas. Later canvas edits do not change the plan.

Cloudflare Workflows executes the plan in dependency order. Each node uses the existing generation runner, receipt storage and atomic result publication. Downstream prompts read successful outputs by the exact generation IDs in this plan. They never look up the latest output from another run.

The parent's remaining reservation and its child's credit reservation transfer in one Postgres transaction. Successful generations remain in the existing debit ledger. Failed steps and unstarted steps release their reservations. Permission is checked at start, before each provider call and before publishing the result. Individual jobs retain their 30-minute timeout; the entire workflow expires after 60 minutes.

The existing service binding dispatches both individual jobs and graph runs to the same native Workflow class. The saved parent is an outbox entry. The 15-minute recovery sweep dispatches missed parents and releases errored or terminated workflows. Child jobs belonging to a graph are excluded from independent dispatch.

## Recovery

A browser reload does not stop execution. An interrupted workflow can recover from its persisted child IDs and completed results without repeating successful generations. Provider submission retains the existing at-most-once safeguards; ambiguous provider responses may require a failed step to be retried explicitly.

After failure, the original payer can choose **Review and resume**. The preview uses the original prompts and settings, reuses successful child IDs for zero additional credits, and reserves only the remaining steps. Resuming creates a new parent and new IDs for unsuccessful steps. A failed parent may be resumed only once; if its successor fails, resume that successor. Completed steps are never refunded or charged twice.

Generated text can exceed the input limit when combined at a downstream node. Such a step stops before calling the provider and releases unfinished credits. Completed upstream outputs remain saved.

## Setup and verification

No new environment variables or services are required. Alchemy applies migration `0012_graph_execution` when development starts, using the existing Neon database, Gateway key, private R2 bucket and Workflow binding.

Automated checks cover graph order, shared ancestors, exclusions, cycles, unsupported inputs, the step limit, stale previews, immutable snapshots, exact output propagation, atomic reservations, insufficient balance, request replay, access changes, expiry, interrupted execution and resuming completed work. Route tests verify authenticated actors and input validation.

Run the tests with `pnpm test`, and types with `pnpm check-types`. `pnpm --filter @kousa/jobs build` creates a Worker dry-run bundle. Stop dev before `pnpm --filter web build:cloudflare`; outside Alchemy, that compile check needs a syntactically valid `DATABASE_URL` even though it does not query the database during the build.

Speech and video real-provider verification remains deferred until the Gateway account supports those models.

Verified locally on September 17, 2026:

- All 237 tests passed, including 15 graph execution tests and three workflow route tests. All 10 workspace type-check tasks passed.
- The jobs Worker dry-run bundle and OpenNext Cloudflare web bundle built. The web compile check used a placeholder database URL; the running app used Alchemy's actual Neon binding.
- Alchemy applied the migration to the development database.
- In the in-app browser, a real Text → Text → Image run completed in the “Workflow example” project. The three-step preview quoted 5 credits, reserved them once, and completed with the balance changing from 491 to 486. Both text outputs and the generated image persisted.
- Reloading during the first generation did not interrupt execution. A second browser tab showed shared progress and outputs. Failure, resume and permission scenarios were verified with isolated Postgres and fake providers to avoid additional provider charges.
