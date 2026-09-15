# Projects and permissions

Projects are private by default. `/dashboard` lists the current account's owned and shared projects, with 20 projects per page. `/projects/[projectId]` opens a saved project and its access controls.

| Action | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Open project | Yes | Yes | Yes |
| Rename project | Yes | Yes | No |
| Create or revoke invite links | Yes | No | No |
| List and manage collaborators | Yes | No | No |

Ownership lives on the project row. It cannot be removed or reassigned through collaborator operations. Memberships contain only editor and viewer roles. Ownership transfer, project deletion, teams, and canvas editing are outside this milestone.

## Invitation flow

1. The owner creates a viewer or editor link from the project page.
2. The owner copies and shares it. Kousa does not send an email.
3. The recipient signs in or creates an account on the invitation page, reviews the role, and clicks **Accept invitation**.
4. Kousa claims the invitation and inserts the membership in one database statement. Only one account can claim it, including under concurrent requests.

Links expire after seven days. An unused link can be revoked. Whoever possesses a link can accept it, so share it with the intended recipient only. Existing members retain their current role when accepting another invitation. Change their role using the owner's access controls. Removing a member does not revoke other unused invitations they may possess; revoke those separately. Accepted links cannot restore removed access.

Invitation tokens contain 32 random bytes. The database stores only their SHA-256 hashes. Raw tokens are returned once and appear in the generated URL fragment, not a query parameter or path. The fragment stays in the browser during sign-in and is removed after acceptance. RPC requests submit the token in a POST body, and error logging records error codes instead of request inputs or database causes. Pending-invitation listings never return tokens or hashes.

## Enforcement and tests

The oRPC router authenticates every operation, including invitation preview and acceptance. The actor always comes from the session. The service validates inputs and handles permission errors; database queries filter reads by access and include authorization in writes. An inaccessible project returns the same not-found response as a nonexistent one.

`pnpm test` runs the real oRPC authentication and validation middleware, project service, Drizzle queries, and checked-in SQL migrations against isolated in-memory Postgres. Tests cover account isolation, pagination, each role, owner preservation, member downgrade/removal, token storage, expiration/revocation, concurrent acceptance, and replay after removal. Tests do not connect to Neon or create real accounts.

There is no new environment configuration. Alchemy applies `0002_needy_liz_osborn.sql` on the next development startup. Future canvas and collaboration endpoints must check project access on every operation and handle permission changes for open connections. These project permissions do not grant access to another account's billing balance.
