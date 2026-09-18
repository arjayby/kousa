# Background generation

Text, image, video, and speech generation run through Cloudflare Workflows in `apps/jobs`. The web request reserves credits, saves the complete input snapshot in Neon and submits the run ID. It returns without waiting for AI. The canvas polls shared status every three seconds: **Queued**, **Generating**, **Saving result**, then success or failure. Owners and editors can run; viewers can observe. The person clicking Generate pays the existing sandbox price only for a saved successful result.

## Local development

Run `pnpm dev` from the root. Alchemy applies the checked-in migrations, supplies the managed Neon URL and existing `AI_GATEWAY_API_KEY`, starts Wrangler on `127.0.0.1:8787`, and starts Next.js on port 3001. No additional environment variables are needed. Do not run a second jobs Worker on the same port.

The web app uses a Wrangler service binding to `kousa-jobs-local`. Both processes use the private local R2 bucket `kousa-media-local` and persist emulator data under `apps/web/.wrangler/state`. Keep that directory to retain local media and workflow state. A local timer invokes Wrangler's scheduled-event endpoint once at startup, then every fifteen minutes, matching the deployed cron. Restart `pnpm dev` after changing bindings or secrets. While local dev is stopped, jobs do not progress; Neon still retains the queue and reservations.

For local workflow inspection:

```sh
cd apps/jobs
pnpm exec wrangler workflows instances list kousa-generation-local --local
```

The local Worker is a loopback-only development endpoint. Production has no public route or `workers.dev` URL; the web service binding is its only dispatch entry. Requests can supply a run ID, never a model, prompt, payer or price. All such values come from the previously authorized database record.

## Recovery and credits

- The queued Neon row is also a durable outbox entry. If the initial dispatch is lost, a scheduled sweep submits pending IDs within fifteen minutes using Workflow `createBatch`, which skips existing IDs. The run UUID is the workflow instance ID.
- An atomic database transition rechecks editor access and records that the provider call has started. A repeated execution cannot cross that boundary again. Gateway SDK retries are disabled.
- The exact provider response is saved under the private R2 prefix `generation-results/`. Images, audio, and video are never embedded in Workflow step results. A replay checks for this receipt before attempting any further work.
- Video submission saves a Gateway operation reference in Neon. Durable sleeps separate status reads, up to 60 polls at 20-second intervals. A restarted runner polls the saved operation instead of submitting again. Status and download failures may retry; paid submissions do not. See [video generation](video-generation.md).
- Storage and publication steps retry with bounded exponential backoff. Publication rechecks permissions and atomically marks the asset ready and the run successful. Repeating finalization cannot charge twice. A lost commit response cannot refund a successful run.
- If a started provider call has neither a receipt nor a saved video operation, recovery waits for the original request's timeout window, then fails the run. **An interrupted provider request is not automatically regenerated.** The provider may have billed the app even though the user receives no saved result. Kousa releases their reservation and they may explicitly generate again.
- Active reservations expire after thirty minutes. Expired runs cannot execute or finalize. The fallback sweep also releases errored or terminated workflows. Successful and failed rows remain as the billing history.
- Temporary receipts are removed when the workflow finishes. A crash after terminal state can leave private orphan receipts, and interrupted media staging can leave pending assets counted toward project quotas. A storage cleanup policy is a separate follow-up; do not delete active job receipts.

Prompt edits after queuing apply to the next run. Upstream nodes are not executed automatically. Deleting a canvas node does not cancel its existing job. Use **Runs** to inspect history and stop work. Queued jobs cancel immediately; submitted requests keep their reservations until they settle. See [run management](run-management.md). Individual video jobs accept a frozen image input through an expiring provider URL; see [video generation](video-generation.md).

## Deployment and limits

Alchemy declares the private jobs Worker, Workflow binding, shared R2 binding, web service binding and fifteen-minute cron in the existing stack. A normal deployment provisions them together; this change does not deploy or upgrade the account.

Cloudflare Workflows supports the Workers Free plan. Its [pricing](https://developers.cloudflare.com/workflows/reference/pricing/) and [limits](https://developers.cloudflare.com/workflows/reference/limits/) apply, including step and CPU quotas. Local success does not verify production CPU usage under the free plan. Existing R2 account activation is still needed for hosted media. The recovery interval allows Neon to [suspend after five idle minutes](https://neon.com/docs/introduction/scale-to-zero); scanning every minute would keep it awake. Vercel's Gateway allowance is separate from Cloudflare usage and Kousa credits.

## Verification

`pnpm test` exercises migrations and credit functions in isolated Postgres, plus queued dispatch, immutable snapshots, replay across new runner instances, lost storage/commit responses, expiry, concurrent calls and permission revocation. `pnpm check-types` checks all workspaces. `pnpm --filter @kousa/jobs build` packages the native Worker without deploying. Stop dev before building the web Cloudflare bundle.

In the browser, queue a generation, reload the canvas, and verify that the saved result arrives and the payer is charged once. A second canvas tab should see the same status and result. Confirm image previews and downloads work: this checks that the jobs and web processes share R2 storage.

Verified locally on September 17, 2026: 182 tests passed, workspace types and both Cloudflare bundles passed, and Next.js reported no runtime or compilation errors. Real text and image jobs completed through the native Workflow emulator. Two canvas tabs showed shared state; a reloaded image preview loaded from shared R2. A text job queued while the Worker was stopped resumed after restarting `pnpm dev` and charged its original reservation once. These checks used five Kousa sandbox credits total (two text runs and one image), leaving the test account at 491. Hosted deployment and production CPU limits have not been tested.
