# Speech generation

**Status: implementation complete, live verification pending.** Gateway paid credits are unavailable for now, so the real-provider check is deferred. Other development can continue. Complete the checks below before releasing speech generation to users.

Select a Speech node, write its script or connect a Text output to its Script input, then choose a voice and optional delivery direction. Wait for the canvas to finish saving and click **Generate speech**. Saved MP3 audio appears on the node and in the inspector, with native playback, seeking, a transcript, and **Download audio**. Viewers can play and download; only owners and editors can generate.

Connected text contributes its last successful output, or its written text if it has no output. That text is followed by the speech node's own script. Kousa reads this script verbatim rather than asking an LLM to rewrite it. Upstream nodes do not run automatically.

## Provider setup

The existing `AI_GATEWAY_API_KEY` in `apps/web/.env` is used by the jobs Worker. No new environment variables or speech-provider keys are needed. Run `pnpm dev` from the repository root; Alchemy applies migration `0010_speech_generation` and starts both apps with shared private R2 storage.

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

See [background generation](background-generation.md) for interrupted provider calls, reservation expiry, and recovery. A lost provider response may incur provider usage even when Kousa releases its reservation. Pending-file cleanup, cancellation, audio uploads, and video generation remain follow-up work.

## Verification

Pending real-provider checks:

- [ ] Generate a short clip through Gateway and the native background workflow.
- [ ] Reload the canvas and confirm the saved clip persists in private project storage.
- [ ] Verify playback, seeking, and download as an editor and a viewer.
- [ ] Confirm the payer is charged exactly 2 Kousa credits once, including after reload.
- [ ] Verify any later feature that consumes this generated audio before releasing that integration.

`pnpm test` covers immutable speech inputs, voice/model allowlists, connected text, limits, permissions, one-time charging, receipt recovery, failed-run refunds, MP3 validation, private byte-range playback, and shared voice edits. The MP3 fixture is a generated 0.2-second sine tone, not a provider recording. Production builds and a real Gateway/native Workflow run are separate checks; a mock provider test cannot establish account eligibility or production performance.

Verified locally on September 17, 2026: 194 tests passed, workspace types and both Cloudflare bundles passed. The in-app browser confirmed the speech controls, Text → Speech connection, persistence, and live voice/direction updates across two tabs. Next.js reported no runtime or compilation errors after fixing an uncontrolled shared-field warning. Real speech generation and playback of a Gateway result remain unverified: the account rejected the initial API probe and paid credits could not be enabled. No Kousa credits were spent; the test account remains at 491.
