# Text generation

Text nodes use the Vercel AI Gateway through AI SDK. Set `AI_GATEWAY_API_KEY` in `apps/web/.env`, then restart `pnpm dev`. Alchemy passes the secret to the Cloudflare Worker as well. No public key, Workflow service or extra hosting provider is required for this milestone.

The picker uses models eligible for Vercel's $5 monthly free allowance. No purchased Gateway credits or BYOK are required while that allowance is available. Free-tier rate limits and model eligibility still apply. Vercel says buying credits moves the account to the paid tier and ends the monthly free allowance, so do not buy credits just to activate this flow. The Vercel allowance is separate from Kousa's sandbox credits purchased through Polar. See [Vercel's current pricing policy](https://vercel.com/docs/ai-gateway/pricing).

The model picker offers Amazon Nova Micro by default and Amazon Nova Lite. Both were verified in [Vercel's Free Tier model filter](https://vercel.com/ai-gateway/models?freeTier=true&q=nova) on September 17, 2026. Existing nodes that stored GPT-4.1 mini or Gemini 2.5 Flash-Lite resolve to Nova Micro on both client and server. No paid-model fallback is configured. Model IDs and the sandbox price live in `packages/generation/src/contracts.ts`. Each successful generation costs **1 Kousa credit from the person running it**. This is provisional sandbox pricing, not a final production margin policy. Input is limited to 12,000 UTF-8 bytes including connected context; output is capped at 2,048 tokens. The provider call times out after 60 seconds and SDK retries are disabled.

## Using the canvas

1. Select a Text node, write a prompt and choose a model.
2. Wait for the shared canvas to finish saving, then click **Generate text**.
3. The result appears on the node and in its settings. Copy it from the output panel, or connect the Text output to another Text node's Context input.

A direct connected Text node contributes its latest successful output. Before its first successful run, it contributes its written content. Connections do not automatically execute upstream nodes. Image, video and speech inputs are rejected for this first text-only flow. Prompts remain editable and are never overwritten by model results; rerun to apply changes. Viewers see results but cannot run nodes. One generation can run at a time per payer, and per node across collaborators.

## Persistence and billing

`@kousa/generation` owns the provider interface and orchestration. `@kousa/projects` owns the shared graph and selected model. `generation_run` in Neon stores input snapshots, output, usage and billing state; these records are never written by the browser or Yjs.

The server reads the saved graph and compares a hash of the relevant prompt, model and source-node text with the client's expected input. A mismatch asks the user to wait for sync or review another editor's changes. Downstream generated context is loaded directly from Neon, never accepted from client-supplied output.

The `kousa_claim_generation` Postgres function in migration `0006_text_generation.sql` locks the payer and project, rechecks editor access and balance, and inserts a reservation in one transaction. This works with Neon's HTTP driver. **Use migrations, not `db:push` alone:** Drizzle's schema does not represent this function.

Available balance is purchase grants minus successful runs and unexpired reservations. Output and the final charge are committed with the same conditional update. Failure releases the reservation. A two-minute lease releases abandoned reservations even without a cleanup job; the next project read or claim marks those records failed. Late completions cannot charge an expired run.

Each click has a UUID request ID. Replaying that ID returns the existing run, and an ambiguous browser error offers **Check run** with the same ID. Database failure after the provider has responded leaves the run reserved until recovery/expiry; the server does not call the provider again. A provider may still bill the application for a timed-out call, although Kousa releases the user's credit when it cannot deliver a saved result.

Canvas tabs poll server-owned results every three seconds while active. This keeps generation state independent of Liveblocks and the future Synixir migration. The request currently stays open until the bounded text call finishes. Browser disconnects or Worker termination can abandon a run; this is not a durable background workflow. Add a durable job runner before implementing long video/image jobs.

## Verification

- `pnpm test`: isolated Postgres tests for reservations, replay, concurrent claims, failures, expiry, permissions and connected text; API auth/validation and Gateway configuration tests.
- `pnpm check-types`: all workspace types.
- Stop dev before `DATABASE_URL=postgresql://build:build@127.0.0.1:9/kousa pnpm --filter web build:cloudflare` to avoid competing Next build outputs. This placeholder is only for packaging, never runtime.
- In the browser, verify one real run decreases the payer's balance by one, appears in a second canvas tab and survives a reload.
