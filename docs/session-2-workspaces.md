# Session 2: workspace ownership and permissions

Status: implemented and verified locally.

## Scope and starting point

The starting revision is `f5cfd38a2fe7f95ea637e392398b1acb7c8b2140`. The working tree was clean before this session.

Session 2 defines workspace ownership, membership, roles, website access permissions, and server-enforced tenant isolation. The user reports Session 1 is complete. The existing local setup is documented in [Run Kousa locally](stack-setup.md).

Website setup belongs to Session 3. Billing, tracked visitor identity, ingestion, funnels, attribution, and cloud deployment belong to later sessions.

The agreed stack and repository architecture guidance remain settled. This interview must resolve the access model before implementation.

## Existing documentation

At the starting revision, the repository has no glossary, glossary map, ADRs, or Session 2 specification. [Run browser tests](browser-tests.md) distinguishes frontend form coverage from real backend authentication coverage.

## Decision tree

The product access model, verification environment, backend responsibility, navigation, acceptance criteria, and deferrals are confirmed. The following table records the last frontier and its dependencies. Its product decisions and final shared-understanding confirmation are resolved.

| Decision                                                 | Prerequisites                                         |
| -------------------------------------------------------- | ----------------------------------------------------- |
| Minimal Website boundary for Session 2                   | Tenant isolation and Session 3 scope                  |
| Browser journeys and acceptance criteria                 | Resolved product behavior and repository fact-finding |
| Explicit deferrals and shared-understanding confirmation | All preceding decisions                               |

Repository fact-finding runs separately from product decisions. Findings cannot substitute for user answers.

## Interview rounds

### Round 1: confirmed

The user answered "yes to all" to Q1 through Q3.

- A Workspace owns websites and forms the tenant boundary. Users access websites through workspace membership. Websites remain with the Workspace when their creator leaves.
- MVP collaboration includes invitations and membership management. Invitation mechanics and authority remain undecided.
- User means a person with a Kousa login. Visitor means someone tracked on a website. Identification on a tracked website grants no Kousa access.

The confirmed terms are recorded in [the glossary](../GLOSSARY.md).

### Round 2: confirmed

The user answered "yes to all" to Q4 through Q6.

- A User can belong to several Workspaces. Each User has at most one Membership per Workspace. Permissions are independent in each Workspace.
- Any signed-in User can explicitly create a named Workspace and become its initial Owner. Signup creates the User only.
- Memberships have one of three Roles: Owner, Admin, or Viewer.

The confirmed permission matrix is:

| Permission                                            | Owner | Admin | Viewer |
| ----------------------------------------------------- | ----- | ----- | ------ |
| View websites and analytics                           | Yes   | Yes   | Yes    |
| Create websites and configure their setup             | Yes   | Yes   | No     |
| Rename the Workspace                                  | Yes   | No    | No     |
| Invite collaborators and manage non-owner memberships | Yes   | No    | No     |
| Transfer ownership                                    | Yes   | No    | No     |

Website setup and analytics are future capabilities. This matrix establishes their access rules without adding those features to Session 2.

Membership, Role, Website, Owner, Admin, and Viewer are recorded in the glossary. Round 3 resolves the number of Owners. Round 4 resolves ownership-transfer safeguards.

### Round 3: confirmed

The user answered "yes to all" to Q7 through Q10.

- A Membership's Role applies to every Website in its Workspace, including Websites added later. Per-website permissions are deferred. Separate Workspaces provide separate access boundaries for clients.
- Each Workspace has exactly one Owner. Co-ownership is deferred.
- The Owner copies an invitation link and sends it themselves. Each Invitation targets a specific email address. Automated invitation emails are deferred. Round 4 resolves acceptance and email ownership checks.
- Admins and Viewers can leave a Workspace themselves. Departure removes only their Membership. It preserves the Workspace's Websites and their other Memberships.

The glossary now records workspace-wide access, a single Owner, and Invitation.

### Round 4: confirmed

The user answered "yes to all" to Q11 through Q14.

- The Owner can transfer ownership to an existing Admin or Viewer. The former Owner becomes an Admin. The transfer is atomic and preserves exactly one Owner.
- The Owner cannot leave or remove their own Membership before transferring ownership.
- Invitation acceptance requires a signed-in User with a verified email matching the Invitation. Email verification is part of Session 2. Ordinary signup and signin remain available before verification.
- Invitations grant Admin or Viewer, expire after seven days, and permit one acceptance. The Owner can revoke an Invitation. Replacing an Invitation invalidates the previous link.
- Inviting an existing member never changes their Role. Role changes use membership controls.
- Removal, departure, and role changes apply to the next protected workspace request after the change commits. Protected workspace data and management operations check current Membership and permissions.
- Membership changes do not sign the User out of Kousa or remove access to other Workspaces. The browser clears the affected Workspace's cached data when it learns access was lost.

### Round 5: confirmed

The user answered "yes to all" to Q15 through Q19.

- Session 2 uses a local development inbox to exercise email verification. Production email-provider configuration is deferred to Session 14. Production invitation acceptance remains unavailable until real delivery is configured.
- Ownership transfer cancels all pending Invitations. The new Owner decides whom to invite.
- Workspace data and management operations validate current Membership. Every website operation also validates that the Website belongs to the requested Workspace. Lists return only accessible Workspaces and resources. Workspace creation, listing the User's Workspaces, and Invitation acceptance use the onboarding rules below.
- Inaccessible and nonexistent resources produce the same not-found response. An existing member lacking permission for an action receives forbidden.
- Better Auth owns login and email verification. Kousa owns Workspace, Membership, Invitation, and ownership-transfer operations through the Effect backend and PostgreSQL. Better Auth's organization plugin remains disabled. [ADR 0001](adr/0001-kousa-owns-workspace-authorization.md) records this tradeoff.
- The selected Workspace appears in the URL. A switcher shows only the User's Memberships, and two tabs can use different Workspaces. Cache entries are scoped by Workspace.
- Users with no Memberships see options to create a Workspace or follow an Invitation. Only Owners see membership-management controls.

### Round 6: confirmed

The user answered "yes to all" to Q20 through Q22.

- Session 2 adds the minimum Website ownership model and reusable server authorization needed to prove website isolation. Tests use seeded Websites in separate Workspaces. Website creation, domains, tracking IDs, and installation UI remain in Session 3.
- The acceptance criteria and verification below define completion.
- Co-ownership, per-website permissions, automated invitation emails, production email configuration, and Workspace or User deletion are deferred.

## Acceptance criteria

The confirmed behaviors are:

1. A User can explicitly create a named Workspace and become its single Owner. Signup alone creates no Workspace. A User can have one Membership in each of several Workspaces.
2. A User can switch Workspaces through the URL and switcher. Separate browser tabs can use different Workspaces. Cache entries are scoped by Workspace. A User with no Memberships can create a Workspace or follow an Invitation.
3. Owners can rename the Workspace, manage non-owner memberships, and create, replace, or revoke Invitations. Admins and Viewers cannot perform those actions. Membership-management controls are visible only to Owners.
4. An Invitation targets one email address, grants Admin or Viewer, expires after seven days, and permits one acceptance. A signed-in User must verify the matching email through the local development inbox before accepting. Expired, revoked, replaced, reused, and wrong-email Invitations cannot grant membership. Invitations never change an existing member's Role.
5. Ownership transfer promotes an existing Admin or Viewer, demotes the former Owner to Admin, and cancels every pending Invitation atomically. Exactly one Owner remains, including under concurrent attempts. An Owner cannot leave or remove their own Membership before a transfer.
6. Admins and Viewers can leave. Removal and departure delete only that Membership. They preserve the Workspace's Websites and the User's other Memberships.
7. Removal, departure, and role changes affect the next protected workspace request after commit. The User stays signed into Kousa. When the browser learns access was lost, it clears the affected Workspace's cached data.
8. Workspace data and management operations check current Membership and required permissions. Website operations also check that the Website belongs to the requested Workspace. Workspace creation and listing the User's Workspaces require authentication, with listing scoped to their current Memberships. Invitation acceptance uses the agreed Invitation and verified-email checks to create a Membership, without requiring prior Membership. Tests use seeded Websites in separate Workspaces to prove isolation through the reusable authorization boundary.
9. Lists return only accessible Workspaces and resources. Inaccessible and nonexistent resources produce the same not-found response. An existing member lacking an action's permission receives forbidden.
10. Browser journeys use the real local backend and PostgreSQL to cover workspace creation and switching, invitations and email verification, membership changes, ownership transfer, and denied access. The existing anonymous-session form tests remain frontend-only coverage.

## Verification plan

Implementation follows the repository's TDD workflow at API, domain, and isolated persistence boundaries. Browser journeys use the e2e skill. Backend tests cover the role matrix, invalid Invitations, tenant isolation, revocation, and ownership invariants under concurrent operations.

The required commands after implementation are:

- Relevant API, domain, and persistence tests, using the actual package scripts available at implementation time.
- `pnpm test:local`
- `pnpm test:e2e`
- `pnpm check`
- `pnpm check-types`
- `pnpm check-types:e2e`

Review compares the complete change against `f5cfd38a2fe7f95ea637e392398b1acb7c8b2140`, including tracked working changes and untracked files. Blocked checks and coverage gaps must be reported. Local verification does not establish production email delivery or production database concurrency behavior.

## Explicit deferrals

- Co-ownership and per-website permissions.
- Automated invitation emails. Owners share invitation links themselves.
- Production verification email-provider configuration, which belongs to Session 14. Production invitation acceptance remains unavailable until real delivery is configured.
- Workspace and User deletion, pending a separate data-lifecycle design.
- Website creation, domains, tracking IDs, and installation UI, which belong to Session 3.
- Billing, analytics, ingestion, tracked visitor identity, funnels, and attribution, which remain in their planned later sessions.
- Hyperdrive migration and cloud deployment. Existing production database behavior must be preserved.

No commit, push, PR, or cloud deployment is authorized by this design interview.

## Implementation notes

Workspace operations live in `packages/api/src/modules/workspaces`. Better Auth continues to own identity and email verification. [ADR 0002](adr/0002-single-owner-with-neon-http.md) explains the database representation of ownership and concurrency checks across both existing PostgreSQL drivers.

The Owner Role derives from the Workspace's Owner reference. Stored Membership Roles are Admin or Viewer. A deferred composite foreign key ensures the Owner remains a member. Mutations compare and advance the Workspace revision, with dependent changes in one SQL statement. A stale revision returns a conflict and requires a refresh.

Invitation secrets are returned only when issued. PostgreSQL stores their hashes, and invitation lists omit secrets. Verified-email acceptance reads the current User record and checks the target email, pending status, expiration, and existing Membership before granting access.

The local inbox uses Mailpit's HTTP API on loopback. Production does not configure a verification delivery callback, and the server disables invitation acceptance there. See [Run Kousa locally](stack-setup.md#create-a-workspace-and-invite-a-member).

Workspace screens live under `apps/web/src/features/workspaces`, composed by TanStack routes. Query inputs and cache metadata include Workspace IDs. Signin and signout clear the query cache. The signed-in layout reconciles successful Membership lists against cached Workspaces, including previously visited Workspaces. Lost Membership clears that Workspace's queries and mutation results. Lost ownership clears Owner-only team data and issued invitation tokens. Voluntary departure uses the same cleanup.

The HTTP entry point rejects untrusted origins for RPC and OpenAPI writes using cookies. Existing RPC handling rejects mutation calls made with GET. The test harness uses the real local Worker and a separate test database. See [Run browser tests](browser-tests.md).

## Validation results

Local verification on October 16, 2026 passed:

| Command                | Result                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| `pnpm test:local`      | 25 tests: 3 database and 22 server tests                                          |
| `pnpm test:e2e`        | 10 tests: 2 frontend auth-form tests and 8 real-backend workspace/transport tests |
| `pnpm check`           | Lint and formatting passed                                                        |
| `pnpm check-types`     | Application and package type checks passed                                        |
| `pnpm check-types:e2e` | Browser test and configuration type checks passed                                 |

Both cache regressions were reproduced before their fixes: returning to an inactive revoked Workspace showed its cached content, and restored ownership showed stale team emails. The regression journeys now prevent both outcomes while new requests are blocked. Each passed three consecutive runs in addition to the full suite.

Additive migrations were applied to the local development and test databases. These results do not establish production email delivery or production database concurrency behavior. Production invitation acceptance remains disabled.

## Shared-understanding checkpoint

Q1 through Q22 are confirmed. The user answered Q23 with "yes, looks good", confirming shared understanding and starting implementation.

## Repository findings

Read-only inspection at the starting revision found the following constraints:

- Better Auth uses email and password authentication with the Drizzle adapter. No organization or membership plugin is configured.
- The database contains only the Better Auth `user`, `session`, `account`, and `verification` tables. There are no workspace, membership, website, invitation, or authorization models.
- Protected oRPC procedures check for a signed-in User only. The oRPC and OpenAPI transports share the router and context.
- PostgreSQL uses `node-postgres` locally and Neon HTTP in production. Hyperdrive remains future work.
- Local auth integration tests cover real signup, signin, session lookup, and signout. Existing browser tests cover forms with an intercepted anonymous session.
- The production Polar scaffold associates customers with Users. Workspace billing remains outside this session, and that scaffold does not determine workspace ownership.
- No invitation or email-verification delivery is configured at the starting revision. Session 2 adds a local verification inbox. Production verification delivery is deferred, and invitation delivery remains manual.
- The frontend has no workspace onboarding, switcher, or membership management. Its query cache has no workspace partitioning.

Further inspection of the installed Better Auth 1.7.7 and Drizzle packages found these implementation constraints:

- Better Auth's organization plugin supports custom roles, membership, and invitations, but permits multiple Owners. It does not supply an atomic exactly-one-Owner transfer.
- The plugin exposes its own HTTP mutation routes. Protecting only Kousa's oRPC procedures would not protect those additional entry paths.
- Better Auth provides `requireEmailVerificationOnInvitation` for invitation identifiers shared outside the recipient's mailbox. Possession of a copyable link and registration with the target email do not independently prove mailbox ownership.
- Local PostgreSQL supports interactive transactions. The current Neon HTTP driver rejects interactive transaction callbacks, but supports atomic batches and individual SQL statements. Atomic ownership changes must work across the supported database paths.

These constraints inform implementation choices. They do not change the confirmed product decisions.

Confirmed terms belong in the glossary as they are resolved. An ADR is warranted only for a hard-to-reverse, non-obvious decision with a real tradeoff.
