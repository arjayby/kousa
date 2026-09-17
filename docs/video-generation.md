# Video generation

**Status: implemented; real-provider verification pending.** The Gateway account currently has no paid credits. No paid video request was made during implementation. Complete the checklist below before releasing this feature to users.

Select a Video node, write a scene and motion prompt or connect a Text output to its Prompt input. Choose an aspect ratio and 5 or 10 seconds, wait for the shared canvas to save, then click **Generate video**. The result appears on the node and in the inspector, with playback, seeking, and **Download video**. Viewers can play and download; owners and editors can generate.

Connected text uses its last successful output, or its written text if it has no output, followed by the Video node's prompt. Upstream nodes do not run automatically. This version creates **silent text-to-video clips**. Image, video, and audio connections must be disconnected before generating; they are not silently ignored.

## Provider and setup

The model is `bytedance/seedance-v1.0-pro-fast` through the existing Vercel AI Gateway key. No new environment variables or provider keys are needed. Run `pnpm dev` from the repository root: Alchemy applies migration `0011_video_generation`, starts the jobs Worker and Next.js, and connects both to shared private R2 storage.

On September 17, 2026, [Gateway's model page](https://vercel.com/ai-gateway/models/seedance-v1.0-pro-fast) listed 480p output at **$0.0097 per second** and **Free Tier: No**. That is approximately $0.0485 for 5 seconds or $0.097 for 10 seconds before any other charges. Paid Gateway credits are required; the free $5 allowance cannot run this model. Availability and pricing may change.

Requests use the [documented Seedance parameters](https://vercel.com/docs/ai-gateway/modalities/video-generation/text-to-video): the `854x480` resolution preset selects 480p, with a separate aspect ratio of `1:1`, `16:9`, `9:16`, or `4:3`. The v1.0 model produces silent MP4 at 24fps. Actual dimensions, codec, duration, download URLs, and decoding still need confirmation from a real result.

## Credits, limits, and persistence

- Successful saved clips cost **10 Kousa credits for 5 seconds**, or **20 for 10 seconds**, charged to the person running the job. This is provisional sandbox pricing, separate from Gateway billing.
- The complete prompt is limited to 12 KB. Video joins the existing one-active-run-per-payer and per-node limits.
- Output must be a complete, non-fragmented, silent H.264 MP4 up to 20 MB, 12 seconds, and 1920 pixels per dimension. MP4Box checks track metadata and sample bounds. Publication also checks duration against the requested duration with a one-second tolerance. Metadata validation does not prove every frame decodes.
- All media share the project quota of 100 files or 100 MB, including staged files. Videos do not appear in the image selector.
- Assets are stored at `projects/{projectId}/videos/{assetId}` in private R2. Authenticated project URLs support GET, HEAD, and single byte ranges. Provider download URLs and operation references are never returned to clients.

The input snapshot includes prompt, model, duration, and aspect ratio. Canvas edits after queuing affect the next run. The adapter uses Gateway's [asynchronous start and status APIs](https://vercel.com/docs/ai-gateway/modalities/video-generation), with the Kousa run ID as the idempotency key and automatic SDK retries disabled.

The job saves the operation reference in Neon, then checks status using durable sleeps. It makes at most 60 polls at 20-second intervals, with bounded retries for status reads and downloads. The existing thirty-minute reservation deadline applies throughout. Completed bytes become a private R2 receipt before validation and publication. Workflow checkpoints contain small status values and asset IDs, not video bytes. Permission checks and final charging use the existing atomic database functions.

A lost submission response is not automatically resubmitted. Kousa releases its reservation, though the provider may already have billed for that request. Failures and expiry retain the previous successful clip. See [background generation](background-generation.md) for recovery, interrupted staging, and cleanup limitations.

## Verification

Automated tests use locally generated H.264 color clips and a mock Gateway; they do not contact a paid provider. They cover saved-operation recovery, duplicate submissions, lost acknowledgements, transient polling/storage failures, timeout, immutable settings, actor billing, revoked permissions, private byte ranges, malformed MP4s, bounded downloads, and concurrent shared settings.

Pending real-provider checks:

- [ ] Enable paid Gateway credits and generate one five-second clip through the native Workflow.
- [ ] Confirm the response's MP4 codec, dimensions, duration, and hosted URL work with the validator/downloader.
- [ ] Reload during generation; confirm the job completes without a second provider submission.
- [ ] Verify playback, seeking, and download as an editor and viewer, including after reload.
- [ ] Confirm the payer is charged exactly 10 Kousa credits once; test 10-second pricing separately.
- [ ] Verify portrait and square output before exposing all aspect ratios in production.

Image-to-video, audio attachment, cancellation, and automatic graph execution remain later steps. Speech's real-provider verification is also still pending.

Verified locally on September 17, 2026: all 219 tests passed, workspace types passed, and both Cloudflare bundles built. Alchemy applied migration `0011_video_generation` to the development database. The in-app browser confirmed the Video controls, 5/10-second pricing, Text → Video connection, unsupported-audio validation, saved settings, and live prompt/settings updates across two tabs. Next.js reported no runtime or compilation errors. The test account remains at 491 credits. A five-second landscape node named “Kousa motion” is connected to the existing Text node; no provider request was submitted.
