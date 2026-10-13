# Run browser tests

Use Node.js 24.8 or newer and the pnpm version in `package.json`.

From the repository root, run:

```sh
pnpm install --frozen-lockfile
pnpm test:e2e
```

The runner starts Vite on a free local port, runs Chromium, and stops the server afterward.
Chromium downloads automatically on the first run. The tests need no AI provider or API key.

To watch the browser, run:

```sh
pnpm test:e2e --headed
```

To run one file, run:

```sh
pnpm test:e2e tests/e2e/auth-forms.e2e.ts
```

To check the config and test types, run:

```sh
pnpm check-types:e2e
```

## Add a test

Create `tests/e2e/<feature>.e2e.ts` and use accessible roles and labels for locators.
Follow the project skill at `.agents/skills/e2e/SKILL.md`.

The initial suite checks signup/sign-in switching and signup validation in the browser.
It supplies an anonymous session response because the local backend is not configured yet.
The config points API requests at a local unused port. These tests do not verify account creation or backend authentication.

For tests that need the backend, add a separate target with a local API and database.
Use disposable test accounts and remove the session interception for those tests.

## Inspect a failure

Read the trace path printed by the runner under `.e2e/results/`.
The complete run report is `.e2e/report.json`.
These outputs are ignored by Git. CI uploads them as artifacts even when a test fails.

To rerun failed tests, run:

```sh
pnpm test:e2e --last-failed
```

See the [TesterArmy e2e documentation](https://e2e.tester.army/docs/quickstart) for additional fixtures and runner options.
