# Node generation history

Select a Text, Image, Video, or Speech node and open **Generation history** in its settings. History includes individual generations and workflow child attempts, newest first. Each entry shows the person who ran it, timestamps, status, model, saved generation settings, and whether credits are reserved, charged, or released. Load older attempts with **Load older generations**.

Text outputs can be copied or downloaded. Images, videos, and speech use the existing private project previews and downloads. The frozen provider prompt or script is available for every attempt. Failed attempts retain their error and released-credit status.

## Choosing an output

**Use this output** selects a successful historical result for the shared node. It changes the displayed result and the input used by future connected generations or narrated clips. It does not change the node's prompt, model, connections, or generation settings, start a generation, or spend credits.

The selection stays pinned when newer generations finish, including failed attempts. **Use latest generation** returns to the latest successful result. Selecting an uploaded/project asset also clears the history selection. Missing or inaccessible selected results fail validation instead of silently using a newer result.

For example, select an older **Coffee scene** image, then choose **Run affected steps** on **Coffee video**. The review includes only video generation and uses the selected image without an image-generation charge. Pinned text similarly supplies its exact saved output without regenerating its upstream branch. If the pinned source is explicitly selected as a workflow output too, it is regenerated when affected or forced, while its consumer still uses the pinned result. An independently connected, unpinned prompt branch runs normally.

Selections synchronize through the shared canvas and support undo/redo. Selecting a result during an active job affects future work only: queued individual jobs, workflow plans, resumes, and clip plans keep their saved inputs. Duplicated nodes and new projects created from templates do not inherit history selections.

## Restoring settings

**Restore settings** restores the authored prompt/script and the model plus relevant image ratio, video duration/ratio, or speech voice/direction. It leaves the selected output, attachments, label, position, connections, and clip settings unchanged. Restoration is one undoable edit and starts no generation. It is disabled while the node has an active generation.

New individual runs and workflow child runs save authored settings separately from the assembled provider prompt. Older workflow attempts recover their authored settings from the immutable workflow plan. Older individual runs without that snapshot remain readable and selectable, but restoration is unavailable because their combined provider prompt cannot safely be split back into authored text and connected inputs. Their frozen prompt can still be copied.

Owners and editors can select outputs and restore settings. Viewers can browse, preview, copy, and download. The server scopes history and actions to project membership and the exact node/run; actions recheck editor access. The client rejects applying a returned patch if the node changed while the request was in flight.

## Storage and setup

Migration `0019_node_generation_history` adds nullable `generation_run.authored_settings` and saves it atomically when claiming an individual run or creating a workflow child. Existing attempt IDs, results, credit accounting, provider receipts, and private media remain unchanged. The shared graph stores only `selectedRunId`; generated content remains in the run ledger and media storage.

History uses timestamp-and-ID cursor pagination with database timestamp precision. Polling runs only while the history dialog is open. No new environment variables, services, or paid provider calls are required. Alchemy applies the migration when development or deployment starts.

See [verification](verification.md#node-generation-history) for automated and browser checks. Live speech/video provider checks remain deferred under their existing prerequisites.
