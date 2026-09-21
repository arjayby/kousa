# Magnific Spaces canvas capabilities

Checked September 19, 2026 against current first-party documentation. This file records competitor capabilities, not a completed Kousa gap audit. The comparison must check each capability against Kousa's implementation.

## Workflow creation and iteration

| Capability | What the documentation establishes |
| --- | --- |
| Conversational workflow creation | Magnific Agent builds and runs workflows in Spaces. Agent results are editable Spaces. Custom agents can carry instructions, reference files, user preferences, and shared project context. The docs identify an Agents panel; they do not establish the exact placement of chat inside an already-open Space. [Agents](https://www.magnific.com/ai/docs/custom-agents) |
| Fast manual construction | Spotlight searches nodes and model variants. Dragging a port to empty canvas opens compatible options and creates a connected node. [Getting started](https://www.magnific.com/ai/docs/getting-started-with-spaces) |
| Selective execution | Run one node, its entire connected workflow, or the selected node and downstream dependents. Independent branches can execute concurrently; cancellation preserves completed outputs. [Nodes and connections](https://www.magnific.com/ai/docs/nodes-and-connections) |
| Batch generation | Lists run a workflow per input item; generators support multiple results per run. [Nodes and connections](https://www.magnific.com/ai/docs/nodes-and-connections) |
| Output history | Node history retains previous generations and their settings. [Nodes and connections](https://www.magnific.com/ai/docs/nodes-and-connections) |
| Cost visibility | Run buttons display credit cost and update when settings change. [Nodes and connections](https://www.magnific.com/ai/docs/nodes-and-connections) |

## Canvas tools

| Capability | What the documentation establishes |
| --- | --- |
| Assistant node | Text output from text, image, or video context; prompt drafting and visual descriptions. This is distinct from the workflow-building Agent. [Nodes and connections](https://www.magnific.com/ai/docs/nodes-and-connections) |
| Media sources | Uploads, generation history, stock, and Community content feed workflows. [Nodes and connections](https://www.magnific.com/ai/docs/nodes-and-connections) |
| Image processing | Creative/Precision upscaling, Camera Angles, and an image-edit action. [Nodes and connections](https://www.magnific.com/ai/docs/nodes-and-connections) |
| Audio production | Voiceover, sound effects, music, and Video Audio Mix nodes. [Nodes and connections](https://www.magnific.com/ai/docs/nodes-and-connections) |
| Organization | Groups, sticky notes, and stickers. [Nodes and connections](https://www.magnific.com/ai/docs/nodes-and-connections) |
| Video processing | The canvas node catalog includes video generation, combination, and upscaling. [Spaces overview](https://www.magnific.com/ai/docs/spaces-overview) |
| Graphic design inside a workflow | Designer is an embedded node, not merely a separate suite application. Connect generated images and text to design placeholders; changing inputs rerenders the design. [Designer](https://www.magnific.com/ai/docs/designer) |
| Finish/export deliverables | Designer supports typography, layers, shapes, masks, image adjustments, independent page sizes, PNG/JPEG/WebP/PDF exports, and named design save points. Its docs describe Auto Resize and selected-element AI edits. [Designer](https://www.magnific.com/ai/docs/designer) |

## Collaboration and reuse

| Capability | What the documentation establishes |
| --- | --- |
| Shared canvas | Live cursors, simultaneous node editing, and visible workflow results. [Collaboration](https://www.magnific.com/ai/docs/collaboration-and-sharing) |
| Contextual review | Comments can be placed on the canvas, replied to, reacted to, searched, filtered by status, and resolved. [Collaboration](https://www.magnific.com/ai/docs/collaboration-and-sharing) |
| Access control | Owner, editor, and viewer permissions, with links and email invitations. Viewers cannot comment according to this guide. [Collaboration](https://www.magnific.com/ai/docs/collaboration-and-sharing) |
| Multiple canvas pages | Separate canvases within one Space; move nodes/groups between pages. Nodes on different pages cannot connect. [Collaboration](https://www.magnific.com/ai/docs/collaboration-and-sharing) |
| Ready-made workflows | Template gallery includes product visuals, social content, and character animation workflows that users copy and modify. [Spaces overview](https://www.magnific.com/ai/docs/spaces-overview) |
| Publish simplified tools | Turn a Spaces workflow into a Flow with labeled inputs, defaults, and an automatically generated interface. Run it standalone or as a node within another Space; chain Flows. [Flows](https://www.magnific.com/ai/docs/flows) |
| Share and automate reuse | Share Flows with collaborators or publish to a gallery. Users can copy a Flow into an editable Space. Saved Flows also run through MCP or an API. [Flows](https://www.magnific.com/ai/docs/flows) |

## Limits on the comparison

- Do not equate the Assistant node with a chat agent that edits the graph. The Agent documentation separately establishes workflow building; the exact chat-panel placement remains unverified.
- The public Spaces landing page lists fewer node types than the detailed docs. Use the detailed docs for capability coverage. [Spaces landing page](https://www.magnific.com/spaces), [help center](https://www.magnific.com/ai/docs)
- Designer has a single-editor lock while other collaborators can view it. Do not describe its editing as simultaneous multi-user design editing. [Collaboration](https://www.magnific.com/ai/docs/collaboration-and-sharing)
- The node guide mentions Evaluator nodes as a paused state, but does not explain enough to assess a complete approval workflow. Treat that as unverified beyond the mention. [Nodes and connections](https://www.magnific.com/ai/docs/nodes-and-connections)
- References and agents with brand knowledge do not prove exact product/character preservation. Output fidelity needs practical testing. No fidelity guarantee is inferred here.
- Other tools in Magnific's navigation are not automatically Spaces nodes. This research only counts tools whose Spaces integration is documented.

For Kousa's product-advertisement example, the most consequential comparison areas are guided workflow construction, batch input/variation handling, reusable workflows, and finishing generated images with controlled text/layout. This is a product judgment, not evidence that every listed feature belongs in the launch scope.
