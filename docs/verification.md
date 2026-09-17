# Generation verification

Last updated September 17, 2026, after adding Speech to workflow execution. Video workflow results were recorded for commit `7942495`.

Text → Image → Video and Text → Speech are implemented. Automated tests and browser checks passed, but successful speech and video generation through the real provider remain unverified. Local development can continue; complete the relevant provider checklist before releasing those features.

## Completed checks

| Check | Result |
| --- | --- |
| `pnpm test` | 289 tests passed, including 16 new speech workflow tests and the existing 16 video workflow tests. |
| `pnpm check-types` | All 10 workspace tasks passed. |
| `pnpm --filter @kousa/jobs build` | Worker dry-run bundle succeeded. |
| `pnpm --filter web build:cloudflare` | OpenNext Cloudflare bundle succeeded with a placeholder database URL. This was a build check, not a deployment. |
| Development migration | Alchemy applied `0015_speech_workflows` to Neon. |
| In-app speech workflow | Scene idea → Street narration quoted 3 credits with Selene and the saved delivery direction. Connection and settings persisted after reload. No public image-delivery origin was required. |
| Earlier video preview checks | Text → Text → Image → Video quoted 15 credits for five seconds and 25 for ten seconds. A selected project image reduced the plan to video only at 10 credits for five seconds. |
| Earlier missing image-delivery origin check | The browser disabled starting. Automated tests confirmed the API rejects the workflow before reserving credits or dispatching upstream steps. |
| Runtime diagnostics | Next.js reported no runtime or compilation errors after the browser checks. |

The speech and video workflow tests use isolated Postgres, fake providers and local media fixtures. They cover exact output propagation, saved inputs and voice settings, recovery without resubmission, resuming only unfinished steps, access changes, and credit accounting. Speech tests also cover the 1,000-character Unicode limit, private audio retrieval, and preserving previous audio after a failed run. These checks do not establish provider eligibility, network reachability, or successful playback of a real provider result.

No AI request was sent during this milestone. The test account stayed at 481 credits. A Street narration node connected to Scene idea remains in the Workflow example project for later verification. Earlier milestone balances and test counts in the feature docs are historical results.

A real Text → Text → Image workflow was already verified, including completion after reload and shared progress across two tabs. See the dated results in [graph execution](graph-execution.md#setup-and-verification).

## Deferred provider checks

| Feature | What is needed | Remaining checks |
| --- | --- | --- |
| Speech | Paid Gateway access for the configured account. No new provider key. | Real generation, persisted audio, editor/viewer playback and download, and a single 2-credit charge. [Checklist](speech-generation.md#verification). |
| Text → Speech workflow | The same speech prerequisite. No public image-delivery origin. | New text is narrated with the saved voice; reload preserves progress; resume reuses completed text and charges only unfinished steps. [Checklist](speech-generation.md#verification). |
| Text-to-video | Paid Gateway access. | Real submission and polling, MP4 compatibility, persistence, playback, and one-time charging. [Checklist](video-generation.md#verification). |
| Image-to-video | Paid Gateway access and a reachable public HTTPS app origin sharing the worker's database and private R2 storage. | Provider fetches the scoped image URL, generated and uploaded image inputs work, and the saved clip plays correctly. [Setup](video-generation.md#private-starting-images) and [checklist](video-generation.md#verification). |
| Text → Image → Video workflow | The same video prerequisites. | Exact new image reaches video, progress survives reload, full cost is charged once, and resume reuses completed work. [Checklist](graph-execution.md#pending-live-video-workflow-verification). |

No paid requests or public deployment were performed for these deferred checks. When verification resumes, record the date, tested commit, run IDs, credit balance before and after, and results in the relevant feature doc. Keep keys, scoped image URLs, and provider tokens out of the record.
