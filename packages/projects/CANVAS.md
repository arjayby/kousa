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

## Project storage and access

Neon stores one versioned graph per project in the `project.canvas` JSONB column. `canvas_revision` starts at zero and increases on every successful save. `canvas_updated_at` records the last save. The additive Drizzle migration `0004_project_canvas.sql` gives existing projects an empty graph without changing their names or memberships. Alchemy runs the migration before starting the app. No additional service or environment variable is needed.

The server loads the graph after checking project membership. Authenticated owners and editors can save; viewers can read, navigate, select, and inspect nodes. Nonmembers receive `NOT_FOUND`, and anonymous requests receive `UNAUTHORIZED`. `projects.getCanvas` and `projects.saveCanvas` enforce these rules independently of the UI. A save checks the actor's current access and expected revision in the same SQL update. Client-supplied roles or user IDs cannot grant permission.

Changes autosave after 700 milliseconds without an edit. **Save** flushes pending changes immediately. Requests are serialized: edits made while a save is in flight wait for its returned revision. The footer distinguishes saved, pending, saving, and failed changes. Selection and viewport changes do not trigger writes. Undo history lasts for the current visit.

The open canvas checks for saved changes every 15 seconds while the tab is active and when the window regains focus. Clean editors and viewers load newer versions. This is periodic refresh, not live collaborative editing. If both editors change the same starting revision, only one save succeeds. The other keeps its unsaved graph and shows **Download my changes** and **Load saved version**. Loading the saved version replaces the current tab's changes. There is no force-overwrite action.

Network failures pause autosave until **Retry save**. If a save succeeded but its response was lost, a later read of the identical saved graph clears the error. Access revocation hides the canvas after the next access check; a rejected save disables editing immediately.

## Browser recovery

Unsaved changes are backed up in localStorage per account and project when storage is available. They are never treated as the shared graph. On reopening, the editor offers **Restore browser draft** only when the backup's base revision still matches the project. Older backups can be downloaded. These recovery copies are best effort and may be replaced by another tab on the same account and project.

A nonempty draft from the previous browser-only milestone can be restored into a project that has never been saved. Existing local drafts are retained until explicitly discarded, and malformed drafts are not overwritten. If a project already has a saved graph, the server version takes precedence and the older draft can be downloaded. **Discard draft** removes only the matching browser copy. Storage failure shows a warning while server saving remains available. A browser unload warning protects pending changes; the recovery copy also survives navigation when storage is available.

## Graph contract

`src/canvas.ts` defines the versioned document independently of React Flow. Node data and edge endpoints are serializable. Transient React Flow state is omitted from storage.

| Node | Inputs | Output |
| --- | --- | --- |
| Text | Context: text, image, video, or speech | Text |
| Image | Prompt: text; reference: image | Image |
| Video | Prompt: text; image: image; video: video; audio: speech | Video |
| Speech | Script: text | Speech |

Each input accepts one connection. Outputs can feed several nodes. Validation rejects unknown endpoints, incompatible inputs, self-links, duplicate input connections, and cycles. Limits are 200 nodes and 600 connections per draft.

`pnpm --filter @kousa/projects test` covers graph validation and autosave coordination, including queued edits, failures, conflicts, permission changes, and out-of-order reads. `pnpm --filter @kousa/api test` exercises the real oRPC middleware and Drizzle queries against PGlite, covering permission enforcement, persistence, concurrent writes, invalid graphs, and migration of existing projects.

The next milestone is live collaboration. Reuse the versioned graph and server permission rules when adding concurrent editing and presence. AI generation and media uploads are separate milestones.
