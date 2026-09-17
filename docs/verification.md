# Generation verification

Last updated September 17, 2026, after refining the workflow output picker. Workflow-wide execution results were recorded for commit `2d49fda`; speech workflow results for `631fb41`; video workflow results for `7942495`.

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

## Deferred provider checks

| Feature | What is needed | Remaining checks |
| --- | --- | --- |
| Speech | Paid Gateway access for the configured account. No new provider key. | Real generation, persisted audio, editor/viewer playback and download, and a single 2-credit charge. [Checklist](speech-generation.md#verification). |
| Text → Speech workflow | The same speech prerequisite. No public image-delivery origin. | New text is narrated with the saved voice; reload preserves progress; resume reuses completed text and charges only unfinished steps. [Checklist](speech-generation.md#verification). |
| Text-to-video | Paid Gateway access. | Real submission and polling, MP4 compatibility, persistence, playback, and one-time charging. [Checklist](video-generation.md#verification). |
| Image-to-video | Paid Gateway access and a reachable public HTTPS app origin sharing the worker's database and private R2 storage. | Provider fetches the scoped image URL, generated and uploaded image inputs work, and the saved clip plays correctly. [Setup](video-generation.md#private-starting-images) and [checklist](video-generation.md#verification). |
| Multi-output workflow | Paid Gateway access for selected speech/video models; public HTTPS origin for image-to-video. | Real multi-branch completion, progress after reload, combined charging once, and partial-failure resume. The full execution path currently has automated coverage using fake providers. |
| Text → Image → Video workflow | The same video prerequisites. | Exact new image reaches video, progress survives reload, full cost is charged once, and resume reuses completed work. [Checklist](graph-execution.md#pending-live-video-workflow-verification). |

No paid requests or public deployment were performed for these deferred checks. When verification resumes, record the date, tested commit, run IDs, credit balance before and after, and results in the relevant feature doc. Keep keys, scoped image URLs, and provider tokens out of the record.
