# Workflow execution

Choose **Run workflow** in the canvas toolbar to select multiple output nodes, or select one node and choose **Run to this node**. The preview lists its ancestors in execution order and the total Kousa credits. Starting reserves the full cost from the person who starts it. A new workflow regenerates every listed node. It does not reuse outputs from earlier, unrelated runs.

Supported paths include Text → Text → Image, Text → Video, Text → Image → Video, and Text → Speech. A shared ancestor runs once. Only the selected outputs and their ancestors participate, with a maximum of 20 steps across the entire workflow. Video-to-video, audio inputs, and image-reference generation remain unsupported. Speech accepts one connected Text script; audio output cannot yet feed another generation step.

The canvas shows a workflow progress button and a status on each participating node. Owners, editors and viewers can see progress. Only owners and editors can start workflows. One workflow may run per project and per payer; individual generation requests wait until it finishes.

## Multiple outputs

The toolbar's **Run workflow** chooser defaults to **All outputs**: nodes without outgoing connections, including disconnected nodes. **Use canvas selection** replaces that set with the nodes selected on the canvas. Any intermediate node can also be selected explicitly. Selecting a downstream output automatically deselects its upstream inputs and disables their checkboxes with **Included automatically**. They remain part of the run. Removing the output makes those inputs selectable again without checking them. Both bulk-selection buttons use the same rule, and separate output branches remain selectable together. The next dialog identifies each selected output, lists shared inputs once, and shows the combined credit reservation before starting.

For example, Text → Image → Video and the same Text → Speech cost 16 credits together (1 + 3 + 10 + 2). The common text runs once and feeds both branches by its exact generation ID. Its checkbox is disabled because it is included automatically. Changing the output set invalidates the reviewed hash, even when it would execute the same steps; merely reordering the selection does not.

Branches execute one step at a time in dependency order. There are no parallel provider submissions. A failure stops the whole workflow, releases unfinished reservations, and leaves successful branches saved. **Review and resume** keeps the original output selection, prompts, settings and successful child IDs. Only the unfinished steps reserve credits again. Changes to the canvas after the run started do not alter its resume plan.

The progress dialog marks selected outputs and shows both their completion count and each step's status. Viewers can inspect progress; only owners and editors can choose outputs or start a run. The initiating user pays for every branch.

## Starting images and preview

When an Image node shows **Latest generation**, a video workflow runs that image and its text dependencies first, even if older outputs already exist. Video receives the new image from this workflow. On resume, a completed image child is reused by its original generation ID for zero additional credits. The video does not switch to a later image generated elsewhere.

When the source Image node has a project image selected, video uses that fixed asset. Its image-generation branch is excluded from the plan and has no generation charge unless that image is also explicitly selected as an output or needed by another branch. The picker keeps that image branch selectable because it is not generated automatically. Selecting it separately regenerates the image, but the video still uses its original fixed asset. An independently connected Text → Video prompt branch still runs. The review dialog explains whether the video uses a new workflow image or a selected project image. Missing or inaccessible project images fail validation before any credits are reserved.

Five-second video costs 10 Kousa credits; ten-second video costs 20. A Text → Image → Video run costs 14 or 24 credits. Each additional text node costs one credit. A selected project image → Video run costs 10 or 20 credits. All prices come from the same generation contract as individual jobs.

Image-to-video requires the [public HTTPS media origin](video-generation.md#private-starting-images) configured for individual video jobs. Preview still shows the step order and cost when the origin is missing, but disables **Start workflow** and explains the requirement. The API also rejects starting the entire workflow before reserving any credits. This avoids spending on upstream steps before encountering a known delivery blocker. Text-only video does not require an image-delivery origin. Video still requires paid Gateway credits; this configuration check does not inspect account funding.

## Persistence and credits

`graph_run` stores a server-built plan with prompts, models, input hashes, dependency IDs, per-step prices, selected-output markers and generation IDs. Older single-output plans without markers continue to use their original target. Video steps also freeze duration, aspect ratio, image selection, and the configured delivery origin. Speech steps freeze voice and delivery direction. Starting checks the preview hash against the saved canvas. Later canvas edits do not change the plan.

Cloudflare Workflows executes the plan in dependency order. Each node uses the existing generation runner, receipt storage and atomic result publication. Downstream prompts read successful outputs by the exact generation IDs in this plan. Video uses the image asset published by the exact image child in its plan. These inputs never look up the latest output from another run.

The parent's remaining reservation and its child's credit reservation transfer in one Postgres transaction. Successful generations remain in the existing debit ledger. Failed steps and unstarted steps release their reservations. Permission is checked at start, before each provider call and before publishing the result. Individual jobs retain their 30-minute timeout; the entire workflow expires after 60 minutes.

The existing service binding dispatches both individual jobs and graph runs to the same native Workflow class. The saved parent is an outbox entry. The 15-minute recovery sweep dispatches missed parents and releases errored or terminated workflows. Child jobs belonging to a graph are excluded from independent dispatch.

## Recovery

A browser reload does not stop execution. An interrupted workflow can recover from its persisted child IDs and completed results without repeating successful generations. Provider submission retains the existing at-most-once safeguards; ambiguous provider responses may require a failed step to be retried explicitly.

After failure, the original payer can choose **Review and resume**. The preview uses the original prompts and settings, reuses successful child IDs for zero additional credits, and reserves only the remaining steps. Resumed video receives a new submission ID and expiring image token, while its completed upstream image stays the same. The current delivery-origin configuration is revalidated for unfinished video steps. Resuming creates a new parent and new IDs for unsuccessful steps. A failed parent may be resumed only once; if its successor fails, resume that successor. Completed steps are never refunded or charged twice.

Generated text can exceed the input limit when combined at a downstream node. Such a step stops before calling the provider and releases unfinished credits. Completed upstream outputs remain saved.

## Speech workflows

Speech reads the connected Text step's new output followed by the Speech node's own script. It reads that text verbatim, with no prompt labels added. A Text → Text → Speech chain narrates the final connected Text output. The preview shows the saved voice and delivery direction, including the original settings when resuming.

Standalone Speech costs 2 Kousa credits, Text → Speech costs 3, and Text → Text → Speech costs 4. No public HTTPS media origin is needed. The configured speech model still requires paid Gateway access; the preview explains this but does not inspect account funding.

The combined script is limited to 1,000 Unicode code points. Written inputs are checked before reservation and generated text is checked again before speech starts. If the new text is too long, the workflow keeps the completed text and releases the speech reservation. Resume uses the original saved plan and outputs, so an oversized saved script needs a new workflow with a shorter upstream prompt rather than another resume attempt.

Failed speech can be resumed for 2 credits after its text dependencies succeed. The resumed job uses those exact text generations and the original voice settings, even if someone edits the canvas or generates newer text. Saved audio receipts and completed speech results are reused during recovery without another provider call or debit.

## Setup and verification

No additional services or keys are required. Alchemy applies migrations through `0016_multi_output_workflows` when development starts, using the existing Neon database, Gateway key, private R2 bucket and Workflow binding.

Automated checks cover graph order, shared ancestors, exclusions, cycles, unsupported inputs, the step limit, stale previews, immutable snapshots, exact output propagation, atomic reservations, insufficient balance, request replay, access changes, expiry, interrupted execution and resuming completed work. Route tests verify authenticated actors and input validation, including empty, duplicate, excessive, or ambiguous output selections. Multi-output tests run all four node kinds with fake providers, verify shared inputs and selected-image behavior, stop after partial success, resume the remaining branch, preserve historical single-output plans, and reject request-ID reuse for a different output set in both the service and atomic SQL claim.

Run the tests with `pnpm test`, and types with `pnpm check-types`. `pnpm --filter @kousa/jobs build` creates a Worker dry-run bundle. Stop dev before `pnpm --filter web build:cloudflare`; outside Alchemy, that compile check needs a syntactically valid `DATABASE_URL` even though it does not query the database during the build.

Speech and video real-provider verification remains deferred until the Gateway account supports those models. See the [verification summary](verification.md) for completed checks and remaining prerequisites.

Initial Text → Text → Image verification on September 17, 2026:

- All 237 tests passed, including 15 graph execution tests and three workflow route tests. All 10 workspace type-check tasks passed.
- The jobs Worker dry-run bundle and OpenNext Cloudflare web bundle built. The web compile check used a placeholder database URL; the running app used Alchemy's actual Neon binding.
- Alchemy applied the migration to the development database.
- In the in-app browser, a real Text → Text → Image run completed in the “Workflow example” project. The three-step preview quoted 5 credits, reserved them once, and completed with the balance changing from 491 to 486. Both text outputs and the generated image persisted.
- Reloading during the first generation did not interrupt execution. A second browser tab showed shared progress and outputs. Failure, resume and permission scenarios were verified with isolated Postgres and fake providers to avoid additional provider charges.

Text → Image → Video extension verification on September 17, 2026:

- All 273 tests passed, including 16 new video workflow tests. All 10 workspace type-check tasks passed. Both the jobs Worker and OpenNext Cloudflare web bundles built successfully.
- Alchemy applied `0014_video_workflows` to the development database.
- In the in-app browser, the existing Text → Text → Image → Video canvas quoted 15 credits for five seconds and 25 for ten seconds. Selecting a project image reduced the plan to the video step at 10 credits. The preview explained which starting image would be used.
- The missing public HTTPS image origin disabled starting before any credits could be reserved. Browser and Next.js runtime checks reported no errors. Original canvas selections were restored after verification.
- No provider calls were made, and the balance remained at 481 credits. Exact image propagation, durable execution, recovery, access checks and credit accounting were exercised with isolated Postgres and fake providers. A real video workflow remains unverified until public HTTPS image delivery and paid Gateway access are available.

Speech workflow extension verification on September 17, 2026:

- All 289 tests passed, including 16 new speech workflow tests. All 10 workspace type-check tasks and both Cloudflare bundles passed. Alchemy applied `0015_speech_workflows` to development Neon.
- Automated checks exercised Text → Speech, Text → Text → Speech, frozen voice settings, exact text reuse after failure, audio receipts, one-time charging, permissions, expiry, private MP3 retrieval and the 1,000-character Unicode limit.
- In the in-app browser, Scene idea → Street narration quoted 3 credits and showed Selene with the saved delivery direction. The connection and settings persisted after reload. No HTTPS tunnel was needed, no generation was started, and the balance remained at 481 credits.
- Live speech generation remains deferred. Its [provider checklist](speech-generation.md#verification) now includes full workflows and resume.

Multi-output workflow verification on September 17, 2026:

- All 303 tests, all 10 workspace type-check tasks, and both Cloudflare bundles passed. Alchemy applied `0016_multi_output_workflows` to development Neon.
- In the in-app browser, **All outputs** selected Street narration and Kyoto motion. The review listed five steps for 17 credits, with Scene idea appearing once. Missing public HTTPS image delivery disabled starting.
- Selecting Scene idea and Kyoto scene showed two outputs across three steps for 5 credits. **Clear** disabled review; **Use canvas selection** selected the highlighted node. An initial custom-preview request returned HTTP 500; retrying succeeded.
- The historical failed speech run remained readable and offered resume for 2 credits, reusing its completed text for zero credits. No new generation or resume was started. The balance stayed at 480 credits and the five-node graph was unchanged.
- Execution and partial-failure resume across all four node types passed with fake providers and local media fixtures. A real multi-output speech/video run remains deferred under the existing provider prerequisites.

Output picker refinement verification on September 17, 2026:

- All 65 tests in the five targeted graph suites passed, including eight new selection tests. All 10 workspace type-check tasks passed. The full test suite and production bundles were not rerun for this refinement.
- In the in-app browser, selecting Visual prompt followed by Coffee scene left one selected output. Visual prompt and Campaign brief became unchecked, disabled inputs marked **Included automatically**. Review still listed all three steps for 5 credits.
- Unchecking Coffee scene left zero outputs, re-enabled its inputs without selecting them, and disabled review. Selecting Coffee video and Voiceover kept two outputs and reviewed six steps for 18 credits, with Campaign brief appearing once. All outputs selected four terminal nodes across the two example workflows.
- Tests also cover selected project images, separately connected video prompts, shared inputs, bulk selections, live canvas edits and cycles. The picker and planner share their dependency rules.
- Next.js reported no runtime or compilation errors. No generation was started; the preview balance remained 458 credits. No setup or migration is required.

## Pending live video workflow verification

These checks require paid Gateway access and a reachable [public HTTPS image origin](video-generation.md#private-starting-images). They have not been run against the real video provider.

- [ ] Run Text → Image → Video with **Latest generation** selected. Confirm video receives the image asset from this workflow's image step, even when that node has an older successful output.
- [ ] Confirm the five-second preview quotes 14 credits, or 15 for the existing Text → Text → Image → Video example. Check the initiating user's final charge matches the preview exactly once.
- [ ] Reload while video is pending and inspect progress in a second tab. Confirm completion persists without a second provider submission.
- [ ] Play, seek and download the saved clip as an editor and viewer, including after reload.
- [ ] Run with a selected project image. Confirm its generation ancestors are excluded and the five-second video-only plan charges 10 credits once.
- [ ] Exercise a controlled failure after upstream steps finish. Review and resume, confirming completed steps cost zero, the video uses the original completed image, and only unfinished steps are charged. Recovery and failure accounting currently have automated coverage only.

## Narrated video exports

Speech → Video Audio is a composition connection. AI workflow planning keeps speech and video as separate outputs, and video generation ignores that audio connection. Generate both branches, then use **Narrated clip** on the Video node to combine their saved files. See [clip composition](clip-composition.md).
