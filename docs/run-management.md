# Run history and cancellation

Open **Runs** in the canvas toolbar to browse workflows and individual generations. The list includes older runs and runs for deleted nodes. Workflow children appear inside their workflow, so they do not duplicate its entry in the list. **Load older runs** retrieves the next page.

Select a run to see who started it, its status, step progress, errors, and credits. Expand **Attempt details and output** to inspect the exact saved text or private media from that attempt, along with its model and frozen prompt or script. **View node** selects the corresponding canvas node and opens its settings. Deleting a node does not delete its saved run or outputs.

## Credits

- **Reserved** credits are held for unfinished work.
- **Charged** credits paid for successfully saved results.
- **Released** credits belonged to cancelled, failed, or blocked work and are available again.

The initial reservation equals these three amounts combined. Steps reused from an earlier run cost zero in this run; their original charge stays with the earlier run. A resumed workflow is a separate history entry with a link to its original workflow.

## Stopping work

Owners and editors can stop project runs. Viewers can inspect history and progress. Cancellation checks project access again inside the database transaction, including when an editor stops another collaborator's run. Credits always belong to the original payer.

| State | Control | Result |
| --- | --- | --- |
| Individual generation still queued | Cancel queued run | Cancels before submission and releases the reservation. |
| Individual generation already submitted | Request stop | Shows **Stopping** while the submitted request settles. |
| Workflow | Stop workflow | Cancels queued children, prevents future steps, and releases their reservations. A submitted child continues settling. |

An already-submitted provider request may still finish and be charged. Its credits stay reserved until the result is saved or the request fails or expires. Stop does not promise a provider-side abort. Successful outputs remain available, including results that arrive after the stop request.

A workflow becomes **Cancelled** once its submitted child settles. If all steps finished before the stop request acquired the lock, it remains **Complete**. Individual submitted generations retain their actual final outcome, **Complete** or **Failed**, and show when stop was requested. Repeating a stop request is safe.

## Continuing after a stop

The original payer can choose **Review and resume** for a cancelled or failed workflow. The review uses the original saved prompts and settings, reuses successful steps at no additional charge, and quotes the unfinished work before starting. Each workflow can be resumed once; further retries use the continuation's entry.

For a cancelled or failed individual generation, **Open node to retry** opens the current node settings. Review those settings before generating again. This action does not submit or reserve credits by itself.

## Persistence and recovery

Migration `0021_run_management` adds cancellation timestamps, cancelled statuses, the standalone history index, and atomic cancellation functions. Submission and cancellation share the payer, project, and run lock order. The database rejects a later workflow step after a stop request, including a delayed worker replay.

During recovery, a stopped workflow can reconcile its already-submitted child through the existing receipt or video-operation recovery path. It cannot queue another child. Late worker errors do not release a submitted child's reservation early. The existing thirty-minute generation expiry, sixty-minute workflow expiry, and fifteen-minute recovery sweep remain in use.

No new keys, services, or environment variables are required. Alchemy applies the migration when starting development or deploying the existing stack. See [background generation](background-generation.md) for runtime setup and [verification](verification.md#run-history-and-cancellation) for completed checks and provider limits.
