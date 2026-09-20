# Canvas chat

Open **Chat** in the canvas toolbar and describe a workflow, for example:

> Write an ad direction for a premium matcha drink, then create a square product image from it.

Kousa proposes connected nodes with prompts, sizes, and an estimated generation cost. Send a follow-up such as “Make it vertical with a cream background” to refine the proposal, or choose **New idea** to start another workflow. **Refine proposal** selects an older proposal as the context for your next message.

Choose **Add to canvas** to insert the proposed nodes and connections as one shared, undoable edit. Then choose **Review generation** to see the actual steps and credit reservation. **Start workflow** runs those steps through the existing durable generation system. The chat itself never starts generation.

## Current scope

- Creates new text, image, video, and speech nodes, with up to 8 nodes and 16 connections per proposal.
- Uses supported generation connections and default models. The server checks the graph, prompts, supported inputs, cycles, and execution limits before saving a proposal.
- Can ask a clarifying question instead of creating nodes.
- Refines a complete proposal before insertion. It does not read or modify existing canvas nodes, inspect uploaded images, browse links, publish, or export. After insertion, use the node inspector to edit settings and prompts.
- Keeps the latest 30 chat requests visible across reloads, privately scoped to the account and canvas. Only nodes added to the canvas become shared with collaborators. Stored chat requests are removed with the canvas or account.
- Planning and insertion use no Kousa credits. There is a persistent limit of 20 planning requests per account per hour and one active planning request at a time. Requests use the existing Gateway text model; provider availability still depends on the configured account.

## Recovery and collaboration

Each request has a saved ID. Retrying the same request recovers its saved status or reply without calling the provider again. A request abandoned for 90 seconds becomes failed; a late response cannot replace that failure. Invalid provider output never edits the canvas or creates a generation charge.

Saved proposals retain their node IDs. Repeated insertion is rejected if any of those IDs are already present, including after reloading or opening another tab. Undo removes the whole insertion; Redo restores it. Insertion rechecks the current canvas and its capacity through the existing permission-enforced Yjs edit path. Current generation costs and changed node settings are checked again by the workflow preview.

Owners and editors can compose workflows. Requests and history enforce current project/canvas access and account ownership. Access is checked again after the provider responds. Model output only supplies bounded node descriptions and connections, never asset IDs, existing node IDs, model IDs, or executable actions.

## Setup and verification

Apply migration `0028_canvas_chat` before serving the updated app. Normal `pnpm dev` and deployment apply it through Alchemy. No new environment variable, service, or provider key is needed; chat uses the existing `AI_GATEWAY_API_KEY`.

Automated checks cover executable proposals, malformed and unsupported graphs, duplicate insertion, canvas capacity, private history, authorization, follow-up ownership, idempotency, concurrent requests, persistent quotas, abandoned requests, and permission revocation during a provider call. API checks cover authentication, session-derived identity, and input bounds.

Browser verification used the real Gateway to compose a two-node text-to-image workflow and refine it to 9:16. Both nodes and their connection inserted together, and a single Undo/Redo removed/restored the full insertion. The workflow generated both outputs for 4 credits: 1 for text and 3 for the image. Reloading recovered the chat, the inserted nodes, and their saved outputs. Reviewing the unchanged workflow then quoted zero credits and disabled starting an unnecessary generation.
