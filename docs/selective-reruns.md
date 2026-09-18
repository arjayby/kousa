# Changed inputs and selective reruns

The canvas marks successful generation outputs **Up to date** or **Outdated**. The node inspector explains changes to prompts, generation settings, connections, selected outputs, or upstream results. Moving or renaming a node does not invalidate it. A video's audio connection belongs to clip composition and does not invalidate AI video generation.

Choose **Run affected steps**, select outputs, and review the plan. Unchanged results show **Reuse · 0 credits**. A changed source regenerates along with its affected descendants; unrelated valid branches are reused. **Force regenerate all steps** switches the review to a full regeneration. The inspector's **Force regenerate** creates another individual result using the currently selected connected outputs, as individual generation did before. Historical output selections stay pinned until changed in generation history.

The review shows the reservation for new generations only. Known configuration blockers identify blocked steps and prevent the entire reservation. If every result is current, the review says no generation is needed. It remains possible to force regeneration. Owners and editors can run; viewers see output status and history.

## Input records and reuse

Migration `0020_selective_reruns` adds `generation_run.resolved_inputs`. Both standalone generations and workflow children save a versioned record of the actual settings, ordered text inputs with exact run IDs and consumed content, and the starting image's exact run/asset references. Object key order in Postgres JSONB is ignored; connected input order remains significant. Even a newer generation with identical output text invalidates consumers because its run ID changed.

A new workflow walks dependencies in order. Reuse requires a successful result with matching inputs, current unpinned ancestors, and available saved output media. Historical selections and uploaded project images are fixed inputs: changing the author's prompt behind a selected output does not regenerate its consumers. Changing the selected output or image asset does.

Older generations without the input record remain viewable and selectable in history. They show **Input history unavailable. Generate once to enable reuse.** No legacy result is silently assumed current. A historical selection can still supply fixed input to a new generation.

The reviewed hash includes the canvas input hash, affected/force mode, and exact reused and fixed references. A result arriving between review and start invalidates an affected review if it changes that plan. Once accepted, the saved plan freezes reused run IDs and project/historical image asset IDs. Workers resolve dependencies only through that saved plan, never through a latest-output lookup.

Reuse can cross editors in the same project. Postgres validates the reused run's project, node, kind, success, and saved asset under the claim transaction. Only new steps reserve the initiating user's credits. The image dependency lookup also accepts a valid reused image created by another editor.

## Failure and resume

Completed and reused steps retain their original run IDs. Failure releases unfinished reservations. Resume preserves the saved plan, outputs, and input choices even after canvas edits. It charges only unfinished generations and retains existing access, expiration, idempotency, and payer checks. New settings should be executed through a new affected review, not by resuming an older plan.

No new environment variables or services are required. Apply migration 0020 before serving the updated app and generation worker.
