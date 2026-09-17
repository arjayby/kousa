# Canvas collaboration

Kousa uses Liveblocks as the current Yjs transport and durable document store. The canvas model, JSON export, and authorization rules belong to Kousa. Synixir can replace the transport when its authentication, persistence, and permission behavior support the same contract.

## Setup

1. Create a Liveblocks project and save its secret as `LIVEBLOCKS_SECRET_KEY` in `apps/web/.env`. Never use a public key for these private project rooms or expose the secret through `NEXT_PUBLIC_*`.
2. Run `pnpm dev`. Alchemy supplies the secret to the Worker and applies the Drizzle migration. Restart development if changing environment variables does not restart it automatically.
3. Open a project canvas in two authenticated tabs. Both should load the existing graph, show online sessions, and receive edits and cursors.

The existing Liveblocks project key is configured locally. Production requires the same server environment setting through Alchemy. No webhook is required for this milestone. Liveblocks' free-plan badge remains enabled.

## Boundaries and data

| Module | Responsibility |
| --- | --- |
| `src/canvas.ts` | Provider-independent JSON graph, limits, and connection rules |
| `src/canvas-document.ts` | Yjs schema, edits, local undo, import, and validated projection |
| `src/collaboration.ts` | Database authorization, serialized initialization and access changes; `CollaborationProvider` contract |
| `src/collaboration-liveblocks.ts` | Private rooms, identity tokens, ACLs, binary import/export, and disconnection |
| `apps/web/src/components/canvas/collaboration-session.ts` | Browser transport contract: document, sync state, peers, presence, reconnect, cleanup |
| `apps/web/src/components/canvas/liveblocks-session.ts` | Liveblocks client adapter and account-scoped IndexedDB recovery |
| `apps/web/src/components/canvas/use-canvas.ts` | React Flow projection and local selection; one adapter factory import |

Each project has room `kousa-<project UUID>`. The Yjs v1 update format contains maps `kousa:nodes:v1`, `kousa:edges:v1`, and `kousa:meta:v1`. Nodes have nested maps with an atomic position, scalar settings, and `Y.Text` label/content/voice direction. Edges use stable UUID keys. Presence is ephemeral and contains a canvas-coordinate cursor and selected node IDs. Names and user IDs come from server-issued identity tokens.

Concurrent operations may temporarily create competing input connections, cycles, or orphaned edges. All replicas sort IDs identically and project the same valid graph under the existing limits. Rejected entries are retained in the CRDT for undo and produce a visible warning. A later generation service must validate the graph again before executing it; room write permission is not graph validation.

## Initial import and authority

A two-minute database lease serializes room initialization and membership changes. Initialization captures the current JSON revision, creates one binary seed, and persists those exact bytes before freezing legacy writes. A lost provider response retries the same update, so it cannot duplicate text or replace later edits. The room is marked ready only after the provider acknowledges the import.

After migration, **Liveblocks holds the current graph**. Neon `canvas`, `canvas_revision`, and `canvas_updated_at` remain the pre-import snapshot, not a continuously updated backup. `getCanvas` retrieves and validates the current Yjs document. Removing the secret or deleting a Liveblocks room does not safely revert the project to its old JSON snapshot.

## Permissions and failures

`POST /api/collaboration/auth` verifies the session, origin, room syntax, and database membership. Owners/editors receive room write permission; viewers receive read and presence-write permission. Rooms have no default public access. Identity tokens do not carry room grants, so cached tokens still require current room ACLs.

Before a member is downgraded or removed, Kousa revokes their provider ACL and disconnects the room, then changes the database role. Provider failure leaves the database change unapplied. A final grant failure after the database update can leave stricter provider access until the next authorized join. Other participants briefly reconnect when any role changes. If a client encounters an access error during this transition, it can use **Retry connection**. The project permission query also refreshes every 30 seconds.

**Liveblocks Storage must remain unused in these rooms.** The adapter uses Liveblocks' documented `deleteStorageDocument` operation to invalidate sockets. That endpoint clears Storage and disconnects users while retaining the separate Yjs document. A real-service smoke check verified document preservation and rejection of cached identities after removal. If Kousa starts using Liveblocks Storage, replace this disconnection mechanism first.

Room operations have ten-second request deadlines; identity token creation happens outside the permission lease. Concurrent joins retry temporary lease conflicts. Browser recovery is isolated by account and project and starts only after writer authorization. It is best effort, not a backup service. A first visit requires a working network connection.

## Migrating to Synixir

Keep this Yjs schema and the `CanvasSession`/`CollaborationProvider` contracts. Before cutover, Synixir needs authenticated project rooms, database-derived editor/viewer permissions, immediate revocation of active sessions, durable binary document storage, state-vector sync and reconnect, and presence with server-verified identity. The existing Synixir flowchart example alone is not the authorization bridge.

For each project:

1. Pause new edits and drain acknowledged Liveblocks updates. Export the complete Yjs binary document and a validated JSON snapshot; retain both as cutover checkpoints.
2. Import the binary into the Synixir room with the same room ID and verify its projected graph matches the checkpoint.
3. Route Kousa's browser session factory and server provider to Synixir, then reconnect participants. Introduce an explicit provider field on projects if migrating them in batches.
4. Test editor/viewer enforcement, revoked active sessions, concurrent text, moves, deletes, connections, offline recovery, and local undo before reopening writes.
5. Keep Liveblocks data until the migration is verified. To roll back after new Synixir edits, export those edits back; the old Liveblocks snapshot alone is no longer current.

Do not allow both providers to accept independent writes during cutover. The application graph and UI can remain unchanged; transport authentication, persistence, and permission invalidation require provider-specific work.

## Verification

Run `pnpm test` and `pnpm check-types`. Alchemy supplies the database binding when it runs `pnpm --filter web build:cloudflare`. For a build-only check outside Alchemy, supply a syntactically valid connection string, for example `DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter web build:cloudflare`; this placeholder is only for compilation/prerendering and must not be used to run or deploy the app. Next.js externalizes Yjs on the server so routes share one module instance for its constructor checks.

The automated suite tests Yjs convergence and authorization against a real PGlite database with a fake provider. Browser verification covers the real Liveblocks connection, shared editing, movement, connections, cursors, local undo, reload, and deletion. A separate temporary Liveblocks room was used to verify viewer write rejection and active permission revocation, then deleted.
