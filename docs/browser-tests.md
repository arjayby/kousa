# Run browser tests

Use Node.js 24.8 or newer and the pnpm version in `package.json`. Start OrbStack on macOS, or make Docker available on Linux.

From the repository root, run:

```sh
pnpm install --frozen-lockfile
pnpm test:e2e
```

The runner starts the local Docker services, prepares `kousa_test`, and starts a Worker and Vite on free local ports. It runs Chromium and stops those application processes afterward. Existing development servers can stay running. Docker services remain available after the run.
Chromium downloads automatically on the first run. The tests need no AI provider or API key.

The backend uses local PostgreSQL and Mailpit. It does not provision cloud resources or access production data. Test accounts use unique email addresses. Cleanup removes their Workspaces, Users, and captured verification messages.

To watch the browser, run:

```sh
pnpm test:e2e --headed
```

To run one file, run:

```sh
pnpm test:e2e tests/e2e/auth-forms.e2e.ts
```

The workspace journeys run with:

```sh
pnpm test:e2e tests/e2e/workspaces.e2e.ts
```

To check the config and test types, run:

```sh
pnpm check-types:e2e
```

## Add a test

Create `tests/e2e/<feature>.e2e.ts` and use accessible roles and labels for locators.
Follow the project skill at `.agents/skills/e2e/SKILL.md`.

The auth-form suite checks signup/sign-in switching and signup validation. It intercepts the session response with an anonymous session. These tests do not verify account creation or backend authentication.

The workspace suite uses real backend requests. It covers creation and switching across tabs, invitation acceptance with email verification, Role changes, ownership transfer, removal, departure, and revoked access. Cache regression journeys block requests to verify that inactive revoked Workspaces and former Owner team data cannot reappear from the cache. API journeys also reject forged request origins and attempts to invoke mutations with GET.

Use disposable test accounts for new journeys. Keep session interception out of tests that claim backend authentication or authorization coverage. Credentials for browser fills are registered with the runner. API fixtures generate temporary passwords and establish real sessions.

## Inspect a failure

Read the trace path printed by the runner under `.e2e/results/`. Application startup logs are in `.e2e/logs/local-app.log`.
The complete run report is `.e2e/report.json`.
These outputs are ignored by Git. CI uploads them as artifacts even when a test fails.

To rerun failed tests, run:

```sh
pnpm test:e2e --last-failed
```

See the [TesterArmy e2e documentation](https://e2e.tester.army/docs/quickstart) for additional fixtures and runner options.

See [Run Kousa locally](stack-setup.md#verify-local-persistence-and-authentication) for real backend auth verification.
