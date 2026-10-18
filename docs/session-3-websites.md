# Session 3: website setup and installation instructions

Status: implemented and verified locally.

## Scope and starting point

The starting revision is `915cc6175378d857b00c2114dc9d69588d3c7bab`. The working tree was clean before this session.

The user reports Session 2 is complete. Session 3 covers Website creation and management for onboarding, a public tracking identifier, and copyable installation instructions. Final deliverables require confirmation through the design interview.

The tracking SDK and event collector belong to Session 4. Durable queue ingestion belongs to Session 5. Session 3 cannot establish successful installation or tracking before real events can be received.

## Inherited decisions

[Session 2](session-2-workspaces.md), [the glossary](../GLOSSARY.md), and the existing authorization code agree on these boundaries:

- A Workspace owns its Websites and retains them when their creator leaves.
- A Membership grants a Workspace-wide Role. Owner and Admin can create Websites and configure their setup. Viewer can read Websites and analytics.
- Current Membership and required permissions are checked on protected requests. Website access also checks the requested Workspace.
- Inaccessible and nonexistent resources return the same not-found response. Members without an action's permission receive forbidden.
- Workspace selection uses the URL. Browser cache data is scoped by Workspace and cleared when access is lost.
- Better Auth owns login and email verification. Kousa owns Workspace authorization. The existing single-Owner model remains settled.

All three Roles can read Website settings and copy installation instructions. Website removal, archiving, and Workspace transfer are deferred.

## Repository findings at the starting revision

- The Website schema currently contains only an internal ID and a Workspace reference. The existing read operation exercises tenant authorization with seeded Websites.
- There is no Website creation, listing, settings screen, hostname configuration, public tracking identifier, SDK, or collector.
- Workspace screens live under `apps/web/src/features/workspaces`. Backend workspace operations live under `packages/api/src/modules/workspaces`.
- Local development uses Vite, a Hono Worker, PostgreSQL, ClickHouse, and Mailpit. Production retains Neon HTTP. Hyperdrive migration and deployment remain separate work.
- Current environment schemas configure server and auth origins but no tracking-script delivery URL.
- Existing session specifications use `docs/session-<number>-<topic>.md`. Domain terms belong in the glossary, acceptance criteria belong here, and consequential tradeoffs may warrant an ADR.
- The lockfile resolves React 19.3.0, Vite 8.3.4, TanStack Router 1.170.42, TanStack Query 5.104.1, oRPC 1.15.5, Better Auth 1.7.7, Drizzle 1.0.0-rc.4, Effect 4.0.3, Hono 4.13.13, and Evlog 2.30.1. The package manager is pnpm 11.24.0.

## Decision tree

The interview uses rounds of independent questions. Dependent questions wait until their prerequisites are settled. Recommendations are proposals until the user accepts them.

| Decision                                                             | Prerequisites                                     |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| What a Website represents within its Workspace                       | Existing ownership model                          |
| Session 3 installation availability and scope exclusions             | Session 4 and Session 5 boundaries                |
| Minimum onboarding fields                                            | Website meaning                                   |
| Hostname normalization, apex, www, subdomains, and local development | Website meaning                                   |
| Duplicate domains and uniqueness scope                               | Hostname identity                                 |
| Settings, snippet access, and removal permissions                    | Existing Roles and Website lifecycle              |
| Public tracking identifier and mutable fields                        | Website identity and lifecycle                    |
| Script URL, environment configuration, snippet, and instructions     | Installation availability and tracking identifier |
| Empty states, validation, and onboarding progress                    | Creation, permissions, and installation behavior  |
| Acceptance criteria, deliverables, and final confirmation            | All preceding decisions                           |

## Interview rounds

Q1 through Q16 are confirmed.

### Round 1: confirmed

The user answered "yes to all" to Q1 through Q3.

- A Website is a separately configured analytics property with one primary hostname, owned by exactly one Workspace. A Workspace can own several Websites. Domain matching details remain for a later round.
- Session 3 provides a copyable snippet and placement instructions that clearly identify the SDK as unavailable until Session 4. Website setup can be saved, but the UI cannot claim installation verification or successful tracking. Script URL and configuration decisions remain open.
- Domain-ownership verification, crawling, remote URL fetching, billing limits, and new Roles are deferred. The SDK and collector remain Session 4. Durable queue ingestion remains Session 5.

The confirmed Website definition is recorded in [the glossary](../GLOSSARY.md).

### Round 2: confirmed

The user answered "yes to all" to Q4 through Q8.

- Creation requires only a Website name and hostname. Timezone, currency, and platform-specific setup remain deferred.
- Hostname identity is exact. Apex, www, and other subdomains represent separate Websites, with no automatic grouping or aliases.
- Users can create a separate Website for localhost development. IP-address and wildcard hostnames remain deferred.
- Owner, Admin, and Viewer can read Website settings and copy the public tracking identifier and snippet. Existing Owner and Admin creation and configuration permissions remain unchanged. Viewer remains read-only.
- Website deletion, archiving, and Workspace transfer are deferred until the data lifecycle is designed. Session 3 management covers listing and editing settings, plus revisiting installation instructions.

Primary hostname is recorded in [the glossary](../GLOSSARY.md).

### Round 3: confirmed

The user answered "yes to all" to Q9 through Q12.

- Accept a bare hostname or HTTP or HTTPS URL, then save only the normalized hostname. Normalization trims whitespace, lowercases, removes a trailing dot, and converts internationalized names to their ASCII form. Scheme, port, path, query, and fragment do not distinguish Websites. Credentials, malformed hostnames, IP addresses, wildcards, and other URL schemes are rejected. Normalized output is shown to the user. For example, `https://WWW.Example.com:8080/docs?x=1` becomes `www.example.com`.
- A normalized hostname is unique within each Workspace. The same hostname can exist in separate Workspaces, and Website names need not be unique. Registration is not proof of domain ownership. Cross-Workspace duplicates disclose no other Workspace's data.
- Each Website receives a generated, globally unique, opaque public tracking ID separate from its internal Website ID. It identifies the Website for future tracking, grants no management or analytics access, remains stable, and has no rotation controls in Session 3.
- The selected Workspace shows its Websites. Owner and Admin see creation controls. Creation navigates to Website settings and installation instructions. Viewers with an empty list receive guidance to contact an Owner or Admin. Progress reports only "Website setup saved" and clearly identifies the SDK as unavailable. No installation checklist implies successful tracking.

Public tracking ID is recorded in [the glossary](../GLOSSARY.md).

### Round 4: confirmed

The user answered "yes to all" to Q13 through Q15.

- Owner and Admin can edit a Website's name and primary hostname. The Website remains in its Workspace and retains both identifiers. Changing the hostname represents correcting or moving the same Website; a distinct analytics property requires creating another Website. Hostname edits use the same normalization and duplicate rules as creation.
- One operator-configured tracking script URL per environment is shared by all Websites. Local development reserves `http://localhost:3000/tracker.js` for Session 4. Deployed configuration requires HTTPS. An absent URL produces a clearly labeled placeholder template rather than an invented production URL. The SDK remains unavailable throughout Session 3, even when a URL is configured.
- The snippet is a plain HTML script tag with `defer`, the configured script URL, and `data-tracking-id` containing the public tracking ID. Instructions place the tag once in each page's head or shared layout. Snippet and ID have separate copy controls, with selectable text as a fallback. Copy feedback reports only clipboard success and never installation or tracking success. The markup is the intended Session 4 SDK contract:

```html
<script defer src="SCRIPT_URL" data-tracking-id="PUBLIC_TRACKING_ID"></script>
```

### Final checkpoint: confirmed

The user answered Q16 with "yes, looks good", confirming shared understanding of the deliverables, acceptance criteria, and deferrals below and authorizing implementation.

## Confirmed deferrals

- Domain-ownership verification, crawling, remote URL fetching, billing limits, and new Roles.
- Tracking SDK and event collector, which belong to Session 4.
- Durable queue ingestion, which belongs to Session 5.
- Timezone, currency, and platform-specific setup.
- IP-address and wildcard hostnames, automatic hostname grouping, and aliases.
- Website deletion, archiving, and transfer between Workspaces, pending data-lifecycle design.
- Public tracking ID rotation and per-Website script delivery configuration.
- Incoming-event hostname enforcement, abuse controls, and installation verification, which require the Session 4 SDK and collector design.
- Cloud provisioning, deployment, and the existing deferred production email and Hyperdrive work.

## Deliverables and acceptance criteria

These criteria consolidate the confirmed decisions and the observable behavior needed to complete them.

### Deliverables

1. Workspace-scoped Website creation, listing, detail, and name and hostname updates through the existing backend and PostgreSQL.
2. A stable public tracking ID for each Website, separate from its internal resource ID.
3. Role-aware Website onboarding, settings, and installation screens in the existing frontend.
4. Environment-configured snippet generation and honest installation instructions for the future SDK.
5. Additive local database migrations, automated coverage, and updated setup and Session 3 documentation.

### Acceptance criteria

1. Owner and Admin can create and edit Websites. Owner, Admin, and Viewer can list and read Websites, settings, public tracking IDs, and installation instructions. Viewer cannot mutate Website settings. No removal, archive, transfer, or tracking-ID rotation controls are introduced.
2. Every protected operation checks current Membership and the required permission. Every Website operation verifies its requested Workspace. Inaccessible and nonexistent resources return the same not-found response; a member without mutation permission receives forbidden. A public tracking ID never grants read or write access to protected data.
3. Creation requires a nonblank Website name and hostname. The server validates both. Hostname normalization follows Q9, with accepted URL input visibly reduced to its saved hostname. No DNS lookup, ownership check, remote fetch, crawl, SDK request, or tracking probe occurs.
4. The database prevents duplicate normalized hostnames within a Workspace, including concurrent creates or edits. The same hostname can exist in another Workspace without revealing that Workspace. Website names can repeat. Apex, www, and other subdomains remain distinct. Localhost is allowed; IP addresses and wildcards are rejected.
5. Creation generates the internal Website ID and a globally unique opaque public tracking ID. Name and hostname edits preserve both identifiers and the Workspace association. Invalid or duplicate submissions do not partially save fields.
6. The selected Workspace shows a Website list and an empty state appropriate to the current Role. Owner and Admin can create a Website and arrive at its detail, settings, and installation instructions. URLs and cache entries retain the selected Workspace and Website. Refresh and direct navigation work, while lost access clears affected cached data using the existing Workspace policy.
7. Forms show validation or duplicate errors, retain entered values after a failed save, prevent repeated submission while pending, and report save success only after the server succeeds. Loading and inaccessible-resource states provide usable navigation. Viewer screens expose no creation or edit controls.
8. Snippets use the configured environment-wide URL and public tracking ID in the confirmed HTML contract. Local setup documents the reserved future SDK URL; deployed URLs require HTTPS. An unconfigured URL produces a visibly labeled placeholder template. No production hostname is invented and no SDK endpoint is implemented in Session 3.
9. The public tracking ID and snippet each have a copy control and selectable fallback text. Copy feedback reflects the actual clipboard result. Instructions place the script once in each page's head or shared layout and state that the SDK is unavailable. The UI never claims installed, verified, receiving events, or tracking successfully.
10. API and isolated PostgreSQL tests cover normalization, duplicates, stable identifiers, the role matrix, changed or revoked access, and cross-Workspace denial. Real-backend browser journeys cover creation, listing, editing, installation instructions, copy behavior, role-aware empty states, and denied access. Existing membership and authentication behavior remains covered by its current tests.
11. Required checks are run and actual results recorded. Review covers the complete change against the starting revision. Actionable in-scope findings are fixed and affected checks rerun. No commit, push, PR, provisioning, or deployment occurs without a separate user request.

## Verification plan

After design confirmation, implementation follows test-first development at the narrowest relevant API or persistence boundary. Authorization and cross-Workspace isolation require coverage. Changed onboarding journeys require real-backend browser tests.

The existing root scripts provide `pnpm test:local`, `pnpm test:e2e`, `pnpm check`, `pnpm check-types`, and `pnpm check-types:e2e`. Required checks run after implementation. The anonymous-session auth-form suite remains frontend coverage only.

Review covers the complete change against the starting revision, including staged, unstaged, and untracked files. Required checks that cannot run must be reported with their blockers and coverage gaps.

## Validation results

Local verification on October 18, 2026 passed:

| Command                | Result                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `pnpm test:local`      | 39 tests: 3 database and 36 server tests, including Website configuration subtests   |
| `pnpm test:e2e`        | 14 tests: 2 frontend auth-form tests and 12 real-backend Workspace and Website tests |
| `pnpm check`           | Lint and formatting passed                                                           |
| `pnpm check-types`     | Application and package type checks passed, including the Vite production build      |
| `pnpm check-types:e2e` | Browser test and configuration type checks passed                                    |

The Website creation, normalization, duplicate-error mapping, update, and installation API behaviors were each observed failing before implementation. The first Website browser journey failed before the new screens existed. Both local databases accepted the checked-in migration.

The optional Hono CLI inspection command `pnpm --filter server exec hono routes` could not load the app because it reported `Dynamic require of "events" is not supported`. The real local Worker integration tests and browser journeys passed; static CLI route inspection remains unavailable in this environment.

These results establish local behavior. They do not establish production email delivery, production database concurrency, OS clipboard permission, SDK delivery, installation verification, or tracking.

## Authorization boundaries

The user confirmed shared understanding and authorized implementation through Q16. This session does not authorize a commit, push, PR, cloud provisioning, or deployment.

## Implementation notes

Website operations live in `packages/api/src/modules/websites`. They reuse the existing Workspace authorization operations. Mutations compare and advance the Workspace revision in the same SQL statement as the Website write, preserving the existing authorization-change safeguards for both PostgreSQL drivers. A database index enforces hostname uniqueness within a Workspace, and a separate unique constraint protects public tracking IDs.

The existing minimal `workspaces.website` read operation remains compatible. The new Website API returns explicit settings contracts. Installation instructions are a separate protected read and distinguish configured script URLs from placeholder templates. Script URL configuration is validated without fetching it. HTML attribute values are escaped before producing the snippet.

Website UI lives under `apps/web/src/features/websites`, composed through routes and the Workspace screen's children. Website and installation queries carry Workspace cache metadata. A missing Website triggers a Membership refresh without immediately treating a valid Workspace Membership as revoked. The existing cache policy clears Website data when Workspace access is lost.

The migration adds required fields to the previous ownership-only Website table and requires that legacy table to be empty. The local development and test databases met that condition. If manually seeded legacy stubs remain, stop and prepare a reviewed migration that adds nullable columns, backfills known settings and generated public tracking IDs, then applies the required constraints. No hostname can be inferred from an ownership-only row, and retained rows must not be deleted to bypass this requirement.

Browser coverage substitutes the privileged Clipboard API boundary for deterministic success and denial checks. API, authentication, and persistence remain real local dependencies. Clipboard values and the text-selection fallback are checked, but OS clipboard permissions are not established by the suite.

## Complete-change review

Separate standards and requirements reviews covered the tracked and untracked change against `915cc6175378d857b00c2114dc9d69588d3c7bab`.

- Standards review found no material defects. Its preventative typing suggestion was applied so Website writes retain the validated hostname type.
- Requirements review found one documentation issue and no runtime defects. Migration instructions now explain how retained legacy stubs require a separate reviewed backfill migration. No requirements findings remain open.
