# Canvas node search and navigation

Use **Search nodes** in the canvas toolbar, or press **⌘/Ctrl K** from the canvas or its controls. The shortcut also works before a canvas element has focus. It leaves text fields, media controls, and dialogs alone.

Search checks every node in the current shared graph, including offscreen nodes. It matches names, types, and prompts without case sensitivity. Speech direction is included. Multiple words must all match, but may match different fields. A blank search lists all nodes in graph order.

Results show the name, type, and a short prompt excerpt around the match. Use the arrow keys and Enter, or click a result, to select it, open its inspector, and center it at up to 100% zoom. This clears any earlier node or connection selection. Escape closes search without changing the selection. Focus returns to the search button when the dialog closes.

**Fit selection** sits beside **Fit all nodes** in the bottom-left viewport controls. It fits selected nodes and both endpoints of selected connections. It is disabled when nothing is selected. Both actions preserve the selection.

Search and navigation are available to viewers as well as editors. They do not edit the shared document, add undo entries, run generation, or spend credits. Search follows current graph changes and does not search the media library or historical outputs.

## Verification

- Project tests cover case, whitespace, names, types, prompt content, speech direction, combined terms, duplicate names, graph updates, literal punctuation, and long prompt excerpts.
- In-app browser checks cover offscreen results, empty results, keyboard navigation, Enter, Escape, shortcut focus, prompt editing, and fitting single nodes, multiple nodes, or connection endpoints.
