# Kousa agent workflow

Apply this workflow to implementation tasks without waiting for the user to invoke each skill. Read the relevant skill instructions before using them. These project rules take precedence over conflicting defaults in installed skills.

## Git conventions

- Use conventional branch prefixes: `feat`, `fix`, `bug`, `chore`, `docs`, `refactor`, `style`, `test`, `perf`, `build`, `ci`, `revert`, or `hotfix`.
- Use Conventional Commits for commit messages.
- Commit, push, or create a PR only when the user requests it. Preserve unrelated work.

## Start with the intended behavior

- Read the affected code, relevant project skills, and any existing glossary, ADRs, or feature specification.
- Record the starting Git revision and identify the scope of the task.
- Use the user's task description and agreed acceptance criteria as the requirements when no written spec exists. Do not require an issue tracker or a formal spec for routine work.
- Resolve material ambiguity before implementing. State reasonable assumptions and continue when the task provides enough information.
- Use `bulletproof-react` for frontend organization and `modular-backend` for backend boundaries. These remain the architecture guidance when another skill suggests different conventions.
- When available, use `domain-modeling` to resolve product vocabulary and document significant domain decisions.

## Implement behavior test-first

- Use `tdd` for new behavior and bug fixes. Write and run a failing behavior test before implementing the change, then add only enough implementation to pass it.
- Work one behavior at a time. Use independent expected results from requirements or worked examples rather than repeating the implementation in the assertion.
- For bugs and performance regressions, use `diagnosing-bugs` to establish a reproducible failure or measurable baseline before fixing the cause.
- Test public behavior. Prefer real local dependencies and replace external providers only where needed. Keep temporary diagnostics and test data out of the final change.
- For refactors, run the existing behavior tests before and after the change. Add coverage first if the relevant behavior is unprotected.

The following test boundaries are pre-agreed for Kousa:

- Domain interfaces for identity merging, session rules, funnels, attribution, and revenue calculations.
- API and event-handler interfaces for input validation, authorization, tenant isolation, and webhook or queue idempotency.
- Persistence integration for database behavior that affects public outcomes, using isolated local test data.
- Browser journeys for navigation, forms, dashboards, and other observable user interactions.

Choose the narrowest relevant boundary from this list, state what it covers, and proceed without requesting the same approval again. This replaces the upstream TDD skill's repeated test-boundary confirmation. If the interface design is uncertain, use Kousa's architecture guidance before introducing another design skill.

## Verify before reporting completion

- Use `e2e` for browser test changes and browser verification. Add or update tests when a user journey changes.
- After each completed implementation task, run the relevant unit or integration tests and `pnpm test:e2e`. Run checks after the completed change, not after every file edit.
- Run `pnpm check` for lint and formatting. Run `pnpm check-types` when TypeScript application code changes, and `pnpm check-types:e2e` when the browser tests or their configuration change.
- Inspect package scripts to find the relevant test commands. Do not invent a command or claim a check passed without running it.
- Skill, documentation, and other changes that cannot affect runtime behavior need formatting and content checks rather than new behavior tests or an e2e run.
- Treat the current auth-form browser suite as frontend coverage. Its anonymous-session response does not verify backend authentication or account creation.
- If a required check cannot run, report the command, the blocker, and the resulting coverage gap. Never silently skip a required check.

## Review the complete change

- Use `code-review` after implementation and verification, before reporting completion or making an authorized commit or PR.
- Use a user-supplied comparison reference when provided. Otherwise use the task's starting revision. Include relevant committed changes, staged and unstaged changes, and new untracked files; a diff ending at `HEAD` alone misses unfinished work.
- Review correctness, security, regressions, architecture, and conformity to the requirements. Give particular attention to tenant isolation, visitor identity, revenue correctness, and repeated event delivery where relevant.
- Use the task description and acceptance criteria for requirements review when there is no written spec. If requirements are unavailable, report that limitation and continue the remaining review. Do not block on tracker setup or spec discovery.
- Fix actionable findings within the task's scope and rerun the affected checks. Keep standards and requirements findings distinguishable.

## Explain and document the result

- Use `technical-writing` and its `unslop` guidance for documentation, commit messages, and PR descriptions when available.
- Use `show-me` when a diagram, pseudocode, or code sketch makes an explanation clearer. Keep simple changes concise; visuals are optional.
- Describe the concrete change, why it matters, actual validation results, and material risks or limitations. Add screenshots for visual changes when they help the reviewer.
- Do not fabricate before-and-after evidence or require a fixed PR template for every change.
