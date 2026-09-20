# Canvas connections

Connecting opens a preview before changing the graph. Drag between handles, select an edge and choose **Review connection**, or use a node's connection controls. The dialog also supports choosing the source, destination, and input with the keyboard. Connecting and previewing do not generate media or spend credits.

The preview shows the source text or saved media, its run ID and time when applicable, and what the destination consumes. Written text is used before a successful text output exists. A selected historical run stays fixed; if it is unavailable, the preview reports that instead of substituting another output. Project assets and the image attachment fallback are identified separately. Run affected steps can regenerate upstream outputs, so its inputs can differ from a single-node Generate preview.

`packages/generation/src/connections.ts` owns connection capability descriptions and output preview resolution. All generation input snapshots use its connection resolver. Current generator limits are checked when connecting, while the stored graph schema still accepts older canvases with unsupported ports. Image → Image Reference edits the selected image with the destination prompt. Video-to-video and non-text context for Text remain unsupported. Speech into Video Audio is composition through Create clip and is never sent to the video generator.

Selecting a node highlights its connected upstream and downstream paths. Upstream nodes have solid outlines; downstream nodes have dashed outlines. Audio composition edges have a dashed line and a Composition label. These highlights describe graph relationships, including fixed historical inputs and composition, rather than promising every highlighted node will regenerate.

Replacing an occupied input or reconnecting an edge validates the final graph using the existing graph rules. The original and occupied edges are removed together with creation of the replacement in one shared-document transaction. One undo restores both old edges. Invalid, cancelled, or permission-rejected edits leave the graph unchanged. The commit checks the current graph again, including whether the old connection still exists, to avoid applying a stale edit.

Coverage includes all port/type combinations, current model limits, text and image output resolution, historical output failures, composition exclusion from video generation, cycle validation after replacement, and undo/redo propagation to another Yjs replica.
