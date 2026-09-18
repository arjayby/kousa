# Multiple canvases

A project contains named canvases. Use **New canvas** in project settings or the canvas header, enter a name, and start with an empty graph. Use the header's canvas selector to switch. The pencil beside a canvas renames it. Owners and editors can create, rename, and edit canvases; viewers can open them.

Each canvas has its own graph, revision, Liveblocks room, browser recovery cache, undo history, generation outputs, workflow runs, and clip jobs. Project membership, media files, and the account's credit balance remain shared. Existing project and account limits on concurrent generation and rendering still apply across canvases.

Canvas links use `/projects/[projectId]/canvas?canvas=[canvasId]`. The original `/canvas` URL opens the project's first canvas. Missing or foreign canvas IDs return not found. Saving a workflow template copies the selected canvas. Copy/paste creates fresh node IDs and keeps project media when both canvases belong to the same project.

Migration `0023_multiple_canvases` moves each project's graph, revision, and collaboration state into `project_canvas` as **Canvas 1**. Its ID matches the project ID, preserving existing room names, cached Yjs updates, and recovery drafts. Newly created projects receive a first canvas atomically, including projects created from templates. Migration `0024_canvas_runs` assigns existing generation, workflow, and clip records to that first canvas. API requests without `canvasId` continue to address the first canvas.

Apply both migrations through the normal Alchemy development or deployment flow before using the updated app. Deploy the web app and workers together. The migration preserves data but removes the old project-level canvas columns, so the previous server version cannot be used after the upgrade.

Project access changes revoke grants and disconnect users from all project canvas rooms before committing the membership change. The project lease renews while visiting rooms. Media cleanup checks every canvas, including live room content, and stops if any room cannot be read.

Tests cover populated database upgrades, independent documents and revisions, owner/editor/viewer permissions, foreign-canvas rejection, separate rooms, project-wide revocation, generation and workflow history isolation, workflow child ownership, clip isolation, selected-canvas templates, and media retention across canvases. Provider execution uses test doubles in these tests.

Verified in the local app on September 18, 2026: the development migrations applied successfully; an existing five-node canvas retained its connections; a new project created separate text and image canvases; renaming, switching, and reloads preserved their contents. All 430 tests across projects, media, generation, and API passed, along with type checks for those packages, the web app, and jobs. No AI generation request was submitted during browser verification.
