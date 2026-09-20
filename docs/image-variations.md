# Image variations

Select an image node and choose **Create variations** in its settings. Prepare 2–8 images with a common prompt, optional instructions for each variation, and independent aspect ratios. Variations inherit the source node's image model.

Choose a starting point:

- **Same inputs** shares the original node's incoming text and image-reference connections. Each new image gets the common prompt plus its own instructions. The source node, its saved results, and downstream connections stay unchanged.
- **Current image** creates one fixed image-reference node from the currently displayed project image or generated result. All variations connect to that reference. Later generations on the original node do not replace it. An uploaded or generated image is required for this option.

**Create variations** adds the nodes and connections as one undoable canvas edit. It does not generate or reserve credits. **Review variations** opens the existing workflow review with only the new image outputs selected. Shared generation inputs appear once. Review the final reservation, then choose **Start workflow**.

The current image model costs 3 credits per new image. Two image outputs with a fixed reference quote 6 credits; changed shared text or generated references can increase the total. The server provides the final quote and checks permissions, balance, assets, and stale inputs before reserving credits. Identical prompts create separate output nodes and separate generation runs. Unchanged successful outputs are reused on later affected-step runs.

Each output is an ordinary image node. Edit it, inspect generation history, add text and logos, or connect it to another step. After closing the builder, use the canvas selection and **Run affected steps** to choose which variations to update. **Runs** provides progress, cancellation, and resume controls. Branches run sequentially; a failed branch preserves completed results and releases unfinished reservations.

Saved layouts do not become references automatically. To vary a text-and-logo composition, use **Save image to canvas** in the layout editor, then create variations from that exported image.

## Limits and collaboration

The builder checks the 200-node and 600-connection canvas limits before insertion. The generation planner validates the combined 20-step limit, supported models, and prompt size before creating nodes. No partial insertion occurs on a validation failure. If source settings, connected inputs, or reference selections change while the draft is open, reopen the builder to use the updated setup. Unrelated branches and node movement do not invalidate it.

Owners and editors can create and run variations. The fixed reference uses the existing authenticated asset-retention path, preserving it for canvas undo and offline drafts. The feature uses existing image nodes, shared document storage, and workflow jobs; no migration, environment variable, or new provider is required.

This release covers image prompt and aspect-ratio variations. CSV imports, collections, video variations, automatic judging, and simultaneous provider submissions are separate work.

## Verification

Automated tests cover shared input planning, fixed references, output isolation, identical prompts, placement, limits, invalid inputs, and changed-source detection. The provider-backed service tests use a fake image provider and an isolated database to verify two separate runs, exact reference bytes, a 6-credit charge, idempotent replay, and a zero-credit repeat preview.

Browser checks verify adding/removing variations, per-image instructions and ratios, both starting points, a 6-credit review, and undo/redo of the complete insertion.

Live verification on September 20, 2026 used the existing development project. Two variations sharing the uploaded product photo completed with different lighting prompts and 1:1 / 4:3 sizes. The 4:3 result saved at 1024 × 768; the square result saved at 1024 × 1024. Reloading during the run did not interrupt it. The balance changed from 418 to 412 credits, matching the 6-credit review. Both outputs remained available after reload. Reviewing the same pair again quoted 0 credits and disabled starting because both results were current.

All 518 automated tests passed. All 10 workspace type-check tasks passed, followed by focused type checks after the final UI refinements. Biome and Next.js runtime/compilation diagnostics were clean.
