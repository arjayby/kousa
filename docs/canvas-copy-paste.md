# Duplicate selections and copy/paste branches

Drag a selection box around the nodes to copy, or use Cmd/Ctrl+A to select every node. The toolbar offers **Duplicate selection**, **Copy selection**, and **Paste nodes**. The inspector's **Duplicate** action still works for one node.

| Action | Shortcut | Result |
| --- | --- | --- |
| Duplicate selection | Cmd/Ctrl+D | Copy the selected nodes beside the originals |
| Copy selection | Cmd/Ctrl+C | Put the selected nodes and their internal connections on the clipboard |
| Paste nodes | Cmd/Ctrl+V | Insert the copied branch near the current view |
| Select all nodes | Cmd/Ctrl+A | Select every node on this canvas |
| Undo / redo | Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z | Remove or restore the entire insertion in one operation |

Shortcuts apply while focus is inside the canvas editor. Prompts, names, other form fields, and media controls retain their normal shortcuts. Copying highlighted text also retains normal browser behavior.

The Copy and Paste buttons also work when the browser denies clipboard access. Kousa keeps the last copied selection in memory for the current account and uses it when the Paste button cannot read the system clipboard. A message identifies when this fallback is used. It survives navigation between projects in the same tab, but not a reload. Copying or cutting ordinary text clears the fallback when Kousa receives that event. Available system clipboard contents always take priority. To paste from another app or browser tab when clipboard access is blocked, focus the canvas and press Cmd/Ctrl+V.

Copies have fresh node and connection IDs, preserve relative positions, and keep authored prompts, models, aspect ratios, durations, voices, and clip settings. Their names receive a `copy` suffix, subject to the existing name limit. All connections whose endpoints are both selected are copied, even if the connection itself was not selected. Connections to unselected nodes are omitted in both directions. Selecting an edge alone does not copy a branch.

New nodes are selected after insertion, and the view fits the graph. Repeated paste adds an offset. Positions are clamped together at the canvas boundary so the branch keeps its spacing. Copy and paste do not start jobs or spend credits.

## Saved results and media

Generation history, generated results, pinned historical run selections, and clip exports stay with the original nodes. Copies begin with no generation history. They preserve authored text rather than substituting the last generated text.

Within the same project, explicit project-media attachments remain attached, including legacy attachments with no explicit source mode. An asset stored behind a node currently showing a generated output is not copied. To reuse a saved generated image, video, or speech file, select it through the project media picker before copying.

Across projects, all asset and historical-run references are cleared. Copied media nodes return to generated-source mode. Attach an available asset from the destination project if the copied workflow needs one. Clipboard project metadata never grants access to a file; existing media and generation authorization still applies.

## Permissions, validation, and collaboration

Viewers can select and copy readable nodes. Insertion requires an owner or editor with a writable canvas, checked again when the shared edit is applied. Clipboard reads that finish after leaving a project are discarded.

The clipboard uses a versioned Kousa document and validates node settings, IDs, ports, connection endpoints, and cycles before insertion. Unsupported clipboard data is rejected with a message. The entire insertion is rejected if it exceeds 200 nodes or 600 connections; no partial branch is added. Unknown runtime fields are stripped.

Each insertion uses one Yjs transaction and one undo item. Undo removes that insertion while preserving unrelated collaborator changes. No migration, new service, or environment variable is required.
