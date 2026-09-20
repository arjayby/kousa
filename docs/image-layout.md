# Text, logo and image export

Select an image node and open **Add text & logo** in its settings. The editor starts with the image currently shown on the node, including a selected historical generation. Saved layouts reopen through **Open saved layout**.

- Add up to 20 text and logo layers. Drag to move, drag the corner to resize, or use percentage fields. Arrow keys move one output pixel; Shift + arrow moves ten.
- Set text, font, weight, alignment, colors and optional solid backgrounds. Text wraps inside its box; overflowing text blocks exports until resized.
- Upload PNG/JPEG/WebP logos or select an image already in the project. Transparent PNGs retain their transparency. Set logo opacity and layer order.
- Choose the original image dimensions or square, portrait, story and landscape presets. Background images support fit and crop.
- **Save layout** stores editable layers on the source node. **Download PNG/JPEG** exports the current draft. **Save image to canvas** saves the editable layout and adds a separate flattened PNG image node for downstream workflows.

Layout edits and local exports require no generation credits. The original image output stays available. To send the composition into an image or video workflow, connect the new exported image node. Saved output uploads use existing project storage limits (100 files / 100 MB; 10 MB per image).

## Persistence and permissions

Layouts live in the shared canvas document as one versioned field on a node. Saving is one undoable canvas edit. The editor maintains its own draft undo/redo history and warns before discarding unsaved work. A save refuses to overwrite a node changed while the dialog was open; download the draft and reopen to resolve it. Viewers can inspect and export saved layouts but cannot modify them.

A saved layout pins its background and logo asset IDs. Later generations do not replace its background. Saving retains all referenced assets for shared canvas history and offline undo. Media lifecycle checks include these references. Templates and cross-project paste preserve styling but clear private image IDs; same-project copies preserve the images.

## Limits

Raster output supports dimensions from 64 to 4096 pixels per side. The first version has three built-in fonts and rectangular layers. Rotation, SVG uploads, masks, custom fonts and batch exports are not included. Preview and export use the same Canvas 2D renderer.

## Verification

Automated coverage checks layer validation, geometry, text wrapping, shared sync and undo/redo, template/clipboard privacy, retention, and generation freshness. Browser checks cover text editing, transparent logo upload, keyboard movement, draft undo/redo, repeated saves, reload persistence, clipping prevention and a 1024 × 1024 PNG saved as a new canvas node. The verified workflow leaves the generation balance unchanged.

PNG and JPEG encoding completed without application errors. Direct file delivery remains unconfirmed in the Codex in-app browser: its automation did not emit a download event. Saving the PNG to the canvas through the authenticated upload path was verified successfully.
