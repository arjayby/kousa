# Speech generation

**Status: implementation complete, live verification pending.** Gateway paid credits are unavailable for now, so the real-provider check is deferred. Other development can continue. Complete the checks below before releasing speech generation to users.

Select a Speech node, write its script or connect a Text output to its Script input, then choose a voice and optional delivery direction. Wait for the canvas to finish saving and click **Generate speech**. Saved MP3 audio appears on the node and in the inspector, with native playback, seeking, a transcript, and **Download audio**. Viewers can play and download; only owners and editors can generate.

With **Generate speech**, connected text contributes its last successful output, or its written text if it has no output. That text is followed by the speech node's own script. Kousa reads this script verbatim rather than asking an LLM to rewrite it. Upstream nodes do not run automatically for this action.

Choose **Run to this node** to generate the connected Text steps first, then narrate their new output. The preview shows execution order, voice, delivery direction, and the total cost. Text → Speech costs 3 Kousa credits; Text → Text → Speech costs 4. The person who starts the workflow pays. Completed text is reused for zero additional credits when resuming failed speech. See [speech workflows](graph-execution.md#speech-workflows) for saved inputs, script limits, and recovery.

## Provider setup

The existing `AI_GATEWAY_API_KEY` in `apps/web/.env` is used by the jobs Worker. No new environment variables, speech-provider keys, or public image-delivery URL are needed. Run `pnpm dev` from the repository root; Alchemy applies migrations through `0015_speech_workflows` and starts both apps with shared private R2 storage.

The allowlisted model is `fish-audio/s2.1-pro-free`, with Sarah, Polo, Selene, Adrian, and Ethan from the [Gateway model playground](https://vercel.com/ai-gateway/models/s2.1-pro-free). On September 17, 2026, Gateway listed this model at zero provider cost but rejected an actual request from an account with only free-tier credits. **Enable paid Gateway credits for this account before testing speech.** Model availability and pricing can change. Kousa does not fall back to another model.

Fish S2.1 supports [bracketed delivery cues](https://docs.fish.audio/developer-guide/core-features/emotions). The adapter prefixes the voice direction as a cue; the saved transcript retains the original script. Direction is guidance and does not guarantee a particular delivery. Custom voice cloning is not included.

## Credits and limits

- Each successful saved clip costs **2 Kousa credits**, charged to the person running it. This is provisional sandbox pricing, separate from Gateway USD billing.
- The complete script, including connected output, is limited to **1,000 Unicode code points**. Voice direction is limited to 500 characters by the shared graph schema.
- Output must be MP3, at most 10 MB and three minutes. The server checks MPEG metadata before staging the asset.
- The existing project quota is shared: 100 media files or 100 MB, including pending files. Image upload and selection remain image-only.
- Text, image, and speech share the existing one-active-run-per-payer and per-node limits. The Gateway request has a 90-second timeout and no automatic SDK retries.

## Persistence and recovery

The durable job stores the script, model, voice, and direction in Neon at queue time. Later canvas edits affect the next run. The exact provider bytes are stored as a private R2 receipt before the workflow advances. Storage retries reuse those bytes. Publication rechecks editor access and atomically makes the audio asset visible and completes the credit charge. Failed runs release the reservation and retain the last successful clip.

Audio assets use `projects/{projectId}/audio/{assetId}` in private R2. Clients receive only authenticated project media URLs. GET supports single byte ranges for seeking; HEAD returns metadata without a body. Access checks apply before range validation, including to viewers whose membership was revoked. Local files remain under `apps/web/.wrangler/state`; hosted R2 activation and deployment are separate.

See [background generation](background-generation.md) for interrupted provider calls, reservation expiry, and recovery. A lost provider response may incur provider usage even when Kousa releases its reservation. Pending-file cleanup, cancellation, and audio uploads remain follow-up work. Text-to-video is documented in [video generation](video-generation.md).

## Verification

See the [verification summary](verification.md) for the latest repository checks. Speech's provider checks below remain pending; passing later test suites does not complete them.

Pending real-provider checks:

- [ ] Generate a short clip through Gateway and the native background workflow.
- [ ] Reload the canvas and confirm the saved clip persists in private project storage.
- [ ] Verify playback, seeking, and download as an editor and a viewer.
- [ ] Confirm the payer is charged exactly 2 Kousa credits once, including after reload.
- [ ] Run Text → Speech through **Run to this node**, confirming the new Text output is narrated with the selected voice and direction. Confirm the full three-credit cost is charged once.
- [ ] Reload while the speech workflow is running and confirm progress, saved transcript, and audio persist. Check shared progress from a second tab.
- [ ] Exercise a controlled speech failure after text completes, then resume. Confirm the original text and voice settings are reused, and only the two-credit speech step is charged on resume.
- [ ] Verify any later feature that consumes this generated audio before releasing that integration.

`pnpm test` covers immutable speech inputs, voice/model allowlists, connected text, limits, permissions, one-time charging, receipt recovery, failed-run refunds, MP3 validation, private byte-range playback, and shared voice edits. The MP3 fixture is a generated 0.2-second sine tone, not a provider recording. Production builds and a real Gateway/native Workflow run are separate checks; a mock provider test cannot establish account eligibility or production performance.

Verified locally on September 17, 2026: 194 tests passed, workspace types and both Cloudflare bundles passed. The in-app browser confirmed the speech controls, Text → Speech connection, persistence, and live voice/direction updates across two tabs. Next.js reported no runtime or compilation errors after fixing an uncontrolled shared-field warning. Real speech generation and playback of a Gateway result remain unverified: the account rejected the initial API probe and paid credits could not be enabled. No Kousa credits were spent during that milestone; the test account remained at 491.

Speech workflow extension verified locally on September 17, 2026: all 289 tests passed, including 16 new speech workflow tests. All ten workspace type-check tasks and both Cloudflare bundles passed. Alchemy applied `0015_speech_workflows`. Browser checks confirmed the three-credit Text → Speech preview, saved voice and delivery direction, and persistence after reload. The Street narration example remains connected to Scene idea with the Selene voice. No provider request was sent and the balance remained at 481 credits. [Detailed verification status](verification.md).
