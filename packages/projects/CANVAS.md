# Canvas editor

Open a project, then choose **Open canvas**. The editor lives at `/projects/[projectId]/canvas` and uses [React Flow](https://reactflow.dev/learn/customization/custom-nodes) for viewport, selection, dragging, and connection gestures.

## Current milestone

- Add text, image, video, and speech nodes. Each node has a name and text, prompt, or script.
- Set image/video aspect ratios, video duration, and speech voice direction. These are draft settings; generation is not connected yet.
- Drag nodes to move them. Connect an output dot to a compatible input, either by dragging or clicking the two dots in order.
- Select a node to edit it. Duplicate or delete it from the settings panel. Select an edge and choose **Disconnect**, or remove it from a node's connection list.
- Drag the background to select several nodes. Scroll or hold Space and drag to pan. Pinch to zoom, or use the zoom and fit controls.
- Delete/Backspace removes a selection. Cmd/Ctrl+Z undoes changes, Cmd/Ctrl+Shift+Z redoes them, and Cmd/Ctrl+D duplicates a selected node. Text inputs keep their normal editing shortcuts.
- Undo keeps up to 50 checkpoints during the current visit. Deleting a node removes attached edges in the same undo operation.

## Draft storage and access

Drafts are saved to localStorage, separately for each account and project. The footer identifies this as a local draft. Reload restores nodes, positions, settings, and connections. Selection, viewport position, and undo history are temporary.

This milestone has no shared canvas storage, media uploads, AI generation, or live collaboration. A collaborator on another account or device cannot see this draft yet. Avoid editing the same local draft in multiple tabs. Clearing browser storage removes local drafts.

The page checks project membership on the server. The client rechecks access every 30 seconds and on window focus. Owners and editors can edit; viewers can navigate and inspect their local draft with changes disabled. A failed access check hides the canvas. Future server persistence must enforce graph write permissions again on the server.

Malformed or unsupported stored drafts are not overwritten. Storage failures show an alert instead of claiming that the draft is saved.

## Graph contract

`src/canvas.ts` defines the versioned document independently of React Flow. Node data and edge endpoints are serializable. Transient React Flow state is omitted from storage.

| Node | Inputs | Output |
| --- | --- | --- |
| Text | Context: text, image, video, or speech | Text |
| Image | Prompt: text; reference: image | Image |
| Video | Prompt: text; image: image; video: video; audio: speech | Video |
| Speech | Script: text | Speech |

Each input accepts one connection. Outputs can feed several nodes. Validation rejects unknown endpoints, incompatible inputs, self-links, duplicate input connections, and cycles. Limits are 200 nodes and 600 connections per draft.

`pnpm --filter @kousa/projects test` covers the connection matrix, cycle prevention, deletion cleanup, stored document validation, and account/project isolation of draft keys.

The next milestone is shared project persistence and collaboration. Keep the versioned document and permission checks, and replace the local draft adapter with the agreed collaboration/storage model.
