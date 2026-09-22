# Workflow templates

Templates are private snapshots of a workflow. Owners and editors can save a project canvas to their own library. Viewers cannot save templates. A template belongs to the person who saves it, including when they are an editor on someone else's project.

## Use a template

1. Open a canvas with at least one node and wait for **All changes saved**.
2. Choose **Save template**, enter a name, and save.
3. On the dashboard, open **My templates**. Each entry shows its name, node count, connection count, and last update date.
4. Choose **Use template**, name the new project, and select **Create project**. Kousa opens its canvas.

The library also supports **Rename** and **Delete**. Deleting a template removes the saved snapshot; existing projects made from it remain available. Each account can keep up to 100 templates, with names from 1 to 120 characters.

## What gets copied

All four node types retain their labels, authored prompts/scripts, model selections, aspect ratios, duration, voice settings, narrated-clip timing and volume settings, positions, and connections. Templates do not update when the source canvas changes. Save another snapshot to capture later edits.

Media attachments, generated text and media results, generation history, clip exports, billing records, collaborators, and collaboration state are excluded. Image, video, and audio nodes start in generated-source mode without an attached asset. If a setup relies on an uploaded reference or existing media, select that media again in the new project.

Every copy receives fresh node and connection IDs, remapped connections, and a separate collaboration room. The creator owns the new private project and can invite collaborators normally. Creating a project does not run the workflow or spend AI credits.

A successfully saved template remains in its creator's library if they later lose access to the source project. This is a deliberate snapshot behavior, not a live link back to the source.

## Storage and access

- `templates.save` reads the graph on the server, using the current collaboration document when the project has a room. It does not accept a graph or owner ID from the client. Saving waits for the local canvas to synchronize.
- The save operation checks current owner/editor access again in SQL before insertion. Library reads and changes are scoped to the authenticated template owner.
- Project creation inserts the project and its initial canvas together. It creates no media, jobs, memberships, or charges.
- Save and create requests carry stable request IDs and immutable request hashes. Repeating a confirmed or uncertain request returns the original result; reusing its ID for different inputs is rejected. Concurrent retries cannot create duplicate templates or projects.
- Deleted templates retain only their request identity and summary metadata, with the document cleared. A delayed retry cannot restore the deleted snapshot. A successful project creation can still be retried after the template is deleted or the project renamed.

Migration `0018_workflow_templates` adds the snapshot table, project provenance columns, and atomic save/create functions. Alchemy applies it through the existing migration runner. Restart `pnpm dev` after adding the migration. No new environment variables, services, or provider keys are needed.

## Verification

Automated tests cover private access, owners/editors/viewers, session-derived ownership, graph validation, empty canvases, limits, permission revocation during save, concurrent retries, deletion, independent IDs and media-free copies, and saving live collaboration state instead of an older database backup. Dated runtime and build results are in [the verification record](verification.md#reusable-workflow-templates).
