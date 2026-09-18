# Implementation verification

Last updated September 18, 2026, after adding reusable workflow templates. Workflow-wide execution results were recorded for commit `2d49fda`; speech workflow results for `631fb41`; video workflow results for `7942495`; narrated clips for `68cd9ba`.

Single-output and multi-output workflows across text, image, video and speech are implemented. Automated tests and browser checks passed, but successful speech and video generation through the real provider remain unverified. Local development can continue; complete the relevant provider checklist before releasing those features.

## Completed checks

The table records the workflow-wide execution milestone. Checks for the subsequent picker refinement are recorded separately below.

| Check | Result |
| --- | --- |
| `pnpm test` | 303 tests passed, including 10 new multi-output execution tests and output-selection route validation. Existing media, speech and video checks still pass. |
| `pnpm check-types` | All 10 workspace tasks passed. |
| `pnpm --filter @kousa/jobs build` | Worker dry-run bundle succeeded. |
| `pnpm --filter web build:cloudflare` | OpenNext Cloudflare bundle succeeded with a placeholder database URL. This was a build check, not a deployment. |
| Development migration | Alchemy applied `0016_multi_output_workflows` to development Neon. |
| In-app multi-output review | All outputs selected Street narration and Kyoto motion. The combined preview showed five steps, Scene idea once, and 17 credits. Missing HTTPS image delivery disabled Start workflow. Clearing the selection disabled Review outputs; Use canvas selection selected the highlighted node. Selecting Scene idea and Kyoto scene quoted 5 credits with Scene idea counted once. |
| Historical workflow resume | The existing failed speech workflow still showed one completed text step. Review and resume quoted 2 credits for speech and zero for the saved text; no resume was started. |
| In-app speech workflow | Scene idea → Street narration quoted 3 credits with Selene and the saved delivery direction. Connection and settings persisted after reload. No public image-delivery origin was required. |
| Earlier video preview checks | Text → Text → Image → Video quoted 15 credits for five seconds and 25 for ten seconds. A selected project image reduced the plan to video only at 10 credits for five seconds. |
| Earlier missing image-delivery origin check | The browser disabled starting. Automated tests confirmed the API rejects the workflow before reserving credits or dispatching upstream steps. |
| In-app media library | Image previews, filename search, type filters, empty results, adding an existing image to the canvas, synchronization to a second session, and undo all passed. Stored files remained available after undo. |
| Runtime diagnostics | Next.js reported no runtime or compilation errors after the browser checks. |

The workflow tests use isolated Postgres, fake providers and local media fixtures. New multi-output checks execute all four node kinds, share an exact text result across branches, preserve a completed video branch when speech fails, resume speech for 2 credits without repeating earlier work, enforce total cost and permissions, reject changed request-ID reuse in SQL, and resume older single-output plans. They cover exact output propagation, saved inputs and voice settings, recovery without resubmission, resuming only unfinished steps, access changes, and credit accounting. Speech tests also cover the 1,000-character Unicode limit, private audio retrieval, and preserving previous audio after a failed run. These checks do not establish provider eligibility, network reachability, or successful playback of a real provider result.

No AI request was sent during the workflow-wide execution milestone. One read-only preview returned HTTP 500; retrying the same selection succeeded. That milestone's browser preview showed 480 credits; the five-node graph was not changed. No additional environment variables or services are required.

No AI request was sent during the earlier media-library milestone. The temporary image node used to check reuse was undone, leaving the original five-node Workflow example graph intact. Its Street narration node remains for later verification. The earlier speech-workflow milestone ended at 481 credits; balances and test counts recorded for earlier milestones are historical results.

A real Text → Text → Image workflow was already verified, including completion after reload and shared progress across two tabs. See the dated results in [graph execution](graph-execution.md#setup-and-verification).

## Output picker refinement

- The five targeted graph suites passed all 65 tests, including eight new tests for redundant output selections, shared inputs, fixed project images, live graph edits and cycles. All 10 workspace type-check tasks passed. The full suite and production bundles were not rerun for this refinement.
- The in-app browser confirmed that selecting Visual prompt followed by Coffee scene deselects and disables Visual prompt with **Included automatically**. The preview still includes Campaign brief, Visual prompt and Coffee scene for 5 credits. Removing Coffee scene re-enables its inputs without checking them and disables review until another output is selected.
- Coffee video and Voiceover remain independently selected. Their preview lists six steps for 18 credits, with Campaign brief counted once. All outputs selected the four terminal nodes in the current eleven-node canvas.
- Next.js reported no runtime or compilation errors. No AI generation was started, the preview balance remained 458 credits, and the canvas content was not edited. No environment changes or migrations are needed.

## Narrated clip composition

- `pnpm test`: **324 application tests passed**. New coverage includes clip permissions and session-derived actors, source project isolation, stale reviews, idempotent retries, immutable inputs, dispatch recovery, concurrency and expiry, private publication without AI charges, shared settings, and keeping composition audio out of AI video dependencies.
- `pnpm --filter @kousa/jobs test:renderer`: **3 actual FFmpeg tests passed**, covering copied H.264 frames, AAC output, narration offset and 50% amplitude, silence padding, trimming at the video end, original audio volume/muting, and invalid inputs.
- All **10 workspace type-check tasks** passed. Biome and `git diff --check` passed for changed files.
- Jobs Worker dry-run and OpenNext Cloudflare web bundles succeeded. The web build used a placeholder database URL and made no deployment. Existing OpenNext middleware and dependency bundle warnings remain.
- Alchemy applied `0017_clip_composition` to development Neon. No paid cloud resources were deployed.
- In the in-app browser, **Clip rendering verification** used uploaded MP4/MP3 fixtures, a Speech → Video Audio connection, a one-second offset, and 50% narration volume. The five-second exported MP4 survived reload.
- A second export used 75% narration volume. The test tab was closed while its UI showed **Rendering**. Reopening showed **Complete** and both exports in the media library. The newest result played to its five-second end with no media error and was reused as a new Video node through **Add to canvas**.
- Next.js runtime diagnostics reported no errors. No AI provider was called, and the browser balance remained **458 credits**.

This verifies local server composition with real FFmpeg. The production Docker/Cloudflare Container deployment has not been exercised. Enabling it requires Workers Paid, Docker on the deployment machine, and `CLIP_RENDERING_ENABLED=true`. Local development needs FFmpeg/ffprobe and no new API keys. Setup and limits are in [clip composition](clip-composition.md).

## Reusable workflow templates

- `pnpm test`: **336 application tests passed**, including 12 new template tests. Coverage includes authentication, private ownership, owner/editor/viewer rules, validation, fresh graph IDs, stripping media and runtime fields, independent projects, live collaboration snapshots, access revocation during saving, concurrent request retries, rename/delete behavior, and the 100-template limit.
- All **10 workspace type-check tasks** passed. Biome and `git diff --check` passed for changed files. The OpenNext Cloudflare web bundle succeeded with the existing middleware and dependency warnings; no deployment was made.
- Alchemy applied `0018_workflow_templates` to development Neon. An initial browser save before restarting development returned a server error because the new migration had not been applied; saving succeeded after the migration.
- In the in-app browser, saved the eleven-node, nine-connection **Workflow example** graph as **Coffee and city workflows**, then renamed the template. Creating **Template copy verification** opened a separate private project with the authored prompts and connections, fresh node IDs, no generated results or workflow history, and an empty media library. The canvas persisted after reload.
- The first join to the new project's Liveblocks room hit an authentication timeout. After reload, the copied graph connected and showed **All changes saved**. This was an observed provider connection issue, not a lost project or snapshot.
- Deleting the verification template emptied the library and preserved the project created from it. Template deletion and safe retries also passed against the real checked-in SQL in isolated Postgres tests.
- Saved a final **Coffee and city starter** template for review and left **Template copy verification** available. Final Next.js diagnostics reported no runtime or compilation errors.
- No AI generation or rendering was started. The browser credit balance stayed at **458 credits**. No new environment variables or services are needed.

See [workflow templates](workflow-templates.md) for usage, copied fields, permissions, and storage behavior. The deferred provider and hosted-renderer checks below remain unchanged.

## Node generation history

- `pnpm test`: **357 application tests passed**. New coverage includes history for all four node kinds, workflow child snapshots, cursor pagination while attempts arrive, owner/editor/viewer permissions, cross-project and cross-node isolation, access revocation, deleted nodes, unavailable media, active/failed attempts, zero-cost selection/restoration, legacy snapshots, and shared selection undo/redo. Template snapshots exclude history selections.
- Workflow checks verify an older image feeds video without regenerating its ancestors, pinned text remains fixed even if its source is explicitly regenerated, edited/empty source prompts do not replace saved text, and oversized saved narration fails before reservation. Clip checks use the selected historical video and speech, including its exact transcript. Queued work retains its frozen inputs after the shared selection changes.
- All **10 workspace type-check tasks** passed. Changed files pass Biome and `git diff --check`. Jobs Worker dry-run and OpenNext Cloudflare web bundles succeeded, with the existing middleware and dependency warnings. No deployment was made.
- Alchemy applied `0019_node_generation_history` to development Neon. No new environment variables or services are needed.
- In the in-app browser, **Coffee scene** displayed its existing individual and workflow successes/failures, credit outcomes, model/settings, and private image previews/download links. A failed attempt disabled output selection; a legacy individual attempt disabled restoration with an explanation.
- Selecting the older image survived reload and appeared in a second tab. **Coffee video → Run to this node** showed exactly one video step, the selected historical image, and 10 credits, with no image-generation charge. The existing missing-HTTPS-origin guard still disabled starting.
- Restoring a workflow attempt changed an edited 16:9 ratio back to 1:1 while preserving the selected old image. Undo returned to 16:9; redo restored 1:1. **Use latest generation** restored the original latest image in both tabs. The project ended with its original eleven nodes, nine connections, empty Coffee scene prompt, and 1:1 ratio.
- The final browser diagnostics reported no runtime or compilation errors. No AI generation or rendering was started, and the balance stayed at **458 credits**. Successful speech/video history is covered with fake providers and media fixtures; no new live provider verification is claimed.

See [node generation history](node-generation-history.md) for usage, exact-output behavior, and legacy restoration limits.

## Deferred provider checks

| Feature | What is needed | Remaining checks |
| --- | --- | --- |
| Hosted clip rendering | Workers Paid, Docker, and the opt-in renderer deployment. | Actual Cloudflare Container startup, server completion after closing the tab, private saved MP4 playback/download, access revocation, and recovery after a container restart. Local FFmpeg rendering is verified. |
| Speech | Paid Gateway access for the configured account. No new provider key. | Real generation, persisted audio, editor/viewer playback and download, and a single 2-credit charge. [Checklist](speech-generation.md#verification). |
| Text → Speech workflow | The same speech prerequisite. No public image-delivery origin. | New text is narrated with the saved voice; reload preserves progress; resume reuses completed text and charges only unfinished steps. [Checklist](speech-generation.md#verification). |
| Text-to-video | Paid Gateway access. | Real submission and polling, MP4 compatibility, persistence, playback, and one-time charging. [Checklist](video-generation.md#verification). |
| Image-to-video | Paid Gateway access and a reachable public HTTPS app origin sharing the worker's database and private R2 storage. | Provider fetches the scoped image URL, generated and uploaded image inputs work, and the saved clip plays correctly. [Setup](video-generation.md#private-starting-images) and [checklist](video-generation.md#verification). |
| Multi-output workflow | Paid Gateway access for selected speech/video models; public HTTPS origin for image-to-video. | Real multi-branch completion, progress after reload, combined charging once, and partial-failure resume. The full execution path currently has automated coverage using fake providers. |
| Text → Image → Video workflow | The same video prerequisites. | Exact new image reaches video, progress survives reload, full cost is charged once, and resume reuses completed work. [Checklist](graph-execution.md#pending-live-video-workflow-verification). |

No paid requests or public deployment were performed for these deferred checks. When verification resumes, record the date, tested commit, run IDs, credit balance before and after, and results in the relevant feature doc. Keep keys, scoped image URLs, and provider tokens out of the record.
