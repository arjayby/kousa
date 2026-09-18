# Canvas editor

Open a project, then choose **Open canvas**. The first canvas lives at `/projects/[projectId]/canvas`; named canvases use `?canvas=[canvasId]`. Use **New canvas** or the header selector to create and switch between canvases. See [multiple canvases](../../docs/multiple-canvases.md). The editor uses [React Flow](https://reactflow.dev/learn/customization/custom-nodes) for viewport, selection, dragging, and connection gestures.

## Current milestone

- Add text, image, video, and speech nodes. Each node has a name and text, prompt, or script.
- Set image/video aspect ratios, video duration, and speech voice direction. Generate individual nodes or review an affected workflow before spending credits.
- Drag nodes to move them. Connect an output dot to a compatible input, either by dragging or clicking the two dots in order.
- Select a node to edit it. Duplicate or delete it from the settings panel. Select an edge and choose **Disconnect**, or remove it from a node's connection list.
- Drag the background to select several nodes. Scroll or hold Space and drag to pan. Pinch to zoom, or use the zoom and fit controls.
- Delete/Backspace removes a selection. Cmd/Ctrl+Z undoes changes, Cmd/Ctrl+Shift+Z redoes them, and Cmd/Ctrl+D duplicates selected nodes with their internal connections. Cmd/Ctrl+A selects all nodes. Cmd/Ctrl+C/V copies and pastes a selection, including between projects. Text inputs keep their normal editing shortcuts. See [branch copying](../../docs/canvas-copy-paste.md) for reference rules and limits.
- Undo affects this tab's edits during the current visit and preserves other collaborators' edits. Deleting a node removes attached edges in the same undo operation.

## Project storage and access

Liveblocks persists a Yjs document per canvas and shares updates as they happen. Neon remains authoritative for projects, memberships, invitations, and billing. On the first authorized connection, the existing Neon graph is imported once; subsequent whole-graph saves are blocked. The original JSON and its revision remain as the pre-collaboration snapshot. `0023_multiple_canvases.sql` moves canvas data into `project_canvas` and preserves existing rooms. Alchemy applies migrations before starting the app.

The server authenticates each connection using Better Auth and derives room access from current database membership. Owners and editors can edit; viewers can navigate, select, inspect, and share presence. Private room permissions also enforce viewer restrictions at the transport level. Role changes revoke existing sockets in every project canvas before reporting success. `projects.getCanvas` reads the current Yjs graph for the selected canvas after checking project membership.

Shared changes include node creation, positions, prompt text, generation settings, deletion, and connections. Text fields use character-level Yjs operations. Presence shows active sessions, names, selection counts, and cursors in canvas coordinates. Selection and viewport position stay local. The footer distinguishes connecting, reconnecting, saving, and acknowledged changes.

Set the server-only `LIVEBLOCKS_SECRET_KEY` in `apps/web/.env` and restart development after changing it. Alchemy supplies the value to the Worker. See [COLLABORATION.md](./COLLABORATION.md) for configuration, failure behavior, and the Synixir migration plan.

## Browser recovery

IndexedDB keeps a best-effort Yjs recovery copy per account and canvas. It is opened only after the server has authorized an editor and synchronized the room. Viewers do not merge former editor drafts. Reconnecting merges pending Yjs operations; browser storage does not bypass room permissions. Liveblocks warns before closing a page with pending writes.

Older localStorage JSON drafts remain available for download or explicit discard. They are never automatically written over the shared graph. Connection failures offer **Retry connection** and a JSON download of the current graph.

## Graph contract

`src/canvas.ts` defines the versioned document independently of React Flow. Node data and edge endpoints are serializable. Transient React Flow state is omitted from storage.

| Node | Inputs | Output |
| --- | --- | --- |
| Text | Context: text, image, video, or speech | Text |
| Image | Prompt: text; reference: image | Image |
| Video | Prompt: text; image: image; video: video; audio: speech | Video |
| Speech | Script: text | Speech |

Each input accepts one connection. Outputs can feed several nodes. Validation rejects unknown endpoints, incompatible inputs, self-links, duplicate input connections, and cycles. Limits are 200 nodes and 600 connections per draft.

`pnpm --filter @kousa/projects test` covers graph validation, Yjs convergence, local undo, deletion conflicts, deterministic connection rules, portable export, and the legacy autosave helpers. `pnpm --filter @kousa/api test` uses PGlite to verify real membership queries, import retries, concurrent initialization, old-save rejection, and permission changes during provider failures.

Generation history, selective reruns, and project media are documented in the repository's `docs/` directory.
