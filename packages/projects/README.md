# Projects and permissions

Projects are private by default. `/dashboard` lists the current account's owned and shared projects, with 20 projects per page. `/projects/[projectId]` opens a saved project and its access controls.

| Action | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Open project | Yes | Yes | Yes |
| Rename project | Yes | Yes | No |
| Send, resend, or revoke invitations | Yes | No | No |
| List and manage collaborators | Yes | No | No |

Ownership lives on the project row. It cannot be removed or reassigned through collaborator operations. Memberships contain only editor and viewer roles. Ownership transfer, project deletion, teams, and canvas editing are outside this milestone.

## Invitation flow

1. The owner enters an email, chooses editor or viewer, and selects a 1, 7, or 30 day expiry.
2. Kousa saves the invitation and sends its unique link through Resend. The owner sees the recipient, role, expiry, invitation status, and email-send status.
3. The recipient signs in or creates an account with that email. If it is unverified, Kousa sends a separate verification email through Better Auth. The recipient verifies it and returns to the invitation to accept.
4. Kousa checks the current account's email and verification status in the database, claims the invitation, and inserts membership in one database statement. Another account cannot preview or accept it.

Email addresses are trimmed and lowercased. There is one current invitation per project and email, with pending, accepted, expired, or revoked status. The list includes all statuses, with 20 entries per page. It is not an audit log of every send attempt.

Resending rotates the token, invalidates the old link, and renews the chosen expiry. Successful sends have a one-minute resend cooldown. A send without a response becomes retryable after two minutes; a reported failure can be retried immediately. Resends do not happen automatically. An inactive invitation can be replaced with a new role. Active members' roles are changed through collaborator controls instead.

Email status is separate from invitation status. **Sent** means Resend accepted the message, not that it reached the inbox. Missing configuration displays **Not sent**. Provider rejections and uncertain results display a failure that the owner can retry. If a network response is lost but the email arrives, its link can still be accepted. A late response from an older send cannot overwrite a newer attempt's status.

Invitation tokens contain 32 random bytes. The database stores only their SHA-256 hashes. Raw tokens appear only in emailed URL fragments, not the owner's API response, a query parameter, or a path. The fragment stays in the browser during sign-in and is removed after acceptance. RPC requests submit tokens in POST bodies; error logging records error codes instead of request inputs or database causes. Invitation listings never return tokens or hashes. Verification callbacks do not include the invitation token.

Existing memberships retain their role if acceptance races with an owner assigning access. Accepted links cannot restore removed access. The owner can send a new invitation after removing a member. Existing sign-in and billing flows do not require email verification; invitation acceptance does.

## Enforcement and tests

The oRPC router authenticates every operation, including invitation preview and acceptance. The actor always comes from the session. The service validates inputs and handles permission errors; database queries filter reads by access and include authorization in writes. An inaccessible project returns the same not-found response as a nonexistent one.

`pnpm test` runs the real oRPC authentication and validation middleware, project service, Drizzle queries, and checked-in SQL migrations against isolated in-memory Postgres. Tests cover account isolation, roles, pagination, email matching and verification, duplicate and concurrent requests, delivery failures, resend rotation, expiry, revocation, and replay after removal. Email transport tests cover the Resend API with stubs. Tests do not connect to Neon or send real email.

See [Resend email setup](../email/README.md) for the sending domain and environment variables. Alchemy applies `0003_wet_bromley.sql` on development startup. This migration revokes old unclaimed invitations without a recipient email and preserves accepted memberships. A dedicated migration test checks both cases.

Canvas reads and writes check project access on the server. Future live collaboration connections must also handle permission changes. These project permissions do not grant access to another account's billing balance.

## Canvas editor

The project's **Open canvas** action opens the text, image, video, and speech editor. See [CANVAS.md](CANVAS.md) for interactions, graph rules, shared storage, conflict handling, and browser recovery copies.
