# Playground

Open **Playground** in the navigation to generate images, video, text, or speech without creating a project or canvas. Pick an output type and model, enter a prompt or script, review the credit cost, then choose **Generate**. The picker uses the same supported models as the canvas. Text currently offers two models; image, video, and speech each offer one.

The browser remembers the signed-in user's draft and settings. Switching models preserves the prompt. Every accepted request appears at the top of **Recent generations**, including its original prompt, settings, status, cost, and saved output. Results remain private to their owner and survive navigation. Use **Use prompt** to restore a previous setup, **Copy** for text, or **Download** for any completed output. History loads automatically when the page opens, including older pages. New runs appear immediately without a manual refresh, and status checks stop when no generation is running.

The existing durable worker executes Playground jobs. They share the same account balance, credit reservations, and per-user concurrency limit as canvas jobs. A failed or expired run releases its reservation. The client retains an uncertain request's ID and settings; **Check generation** retries that exact request without buying another run.

## Add to canvas

Choose **Add to canvas**, then an editable project and canvas, or create a project. The destination editor imports the result once its shared document is connected. The import keeps the prompt, model, settings, and selected output. It participates in the canvas's normal saving and undo behavior.

The server checks personal ownership and destination editing access. Media is copied into the destination project's private storage, using its existing deduplication and quota rules. A saved generation record with zero credits links the imported output to the destination node. Repeating the same import into a canvas returns the same node and output record. The original remains in personal history. Project members can access the imported copy without gaining access to the owner's Playground.

## Storage and rollout

Migrations `0025_playground` and `0026_playground_input_history` allow generation runs without a project or canvas and give personal media an explicit owner. Database constraints distinguish personal and project records. Personal assets use an authenticated `/api/playground/media/[assetId]` endpoint and a separate private object-key prefix. The personal storage limit is 100 files or 100 MiB, including pending writes. This version retains saved personal media; deletion and storage management remain follow-ups.

Apply the migration before deploying the updated web app and jobs worker. Local Alchemy development applies tracked migrations when the stack starts. Tests run the complete migrations against PGlite and exercise ownership, credit reservations, retry recovery, personal media delivery, and imports with no additional charge.

Simultaneous model comparison and reference-image uploads are outside this first version. Users can switch models and inspect earlier results in history.
