# Orchestration: Week 14 Device Revoke

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the existing schema supports owner-scoped active-device revocation, do not add a migration.
- If token refresh rows are not cleaned up, treat `devices.revoked_at` as the authoritative rejection source and record token cleanup as best effort.
- If the route cannot identify the current device from the access token, extend the authenticated request helper rather than parsing tokens twice.

## Packet Prompts

- `01-repository-device-revoke`
  - Objective: add a repository operation that marks an active owner-scoped device revoked and cleans up active refresh rows.
  - Files: `src/repositories/auth-repository.ts`, `test/repositories/auth-repository.test.ts`.
  - Verification: targeted auth repository tests pass.
- `02-route-device-revoke`
  - Objective: add an authenticated revoke route that blocks current-device self revoke.
  - Files: `src/app.ts`, `test/app.test.ts`, `test/support/fake-d1.ts`.
  - Verification: app tests cover success, self-revoke rejection, and missing target.
- `03-refresh-coverage-docs`
  - Objective: prove revoked-device refresh fails and record Week14 state.
  - Files: `test/app.test.ts`, `specs/week-14-device-revoke.md`, `docs/current-state.md`, workflow files.
  - Verification: refresh-grant tests and docs checks pass.
- `04-verification`
  - Objective: prove the integrated slice is ready to push.
  - Files: no source ownership.
  - Verification: full local gates, brand scan, push, and CI result.

## Completion Audit

- Confirm route derives current device from the verified access token.
- Confirm active owner-scoped device revoke changes `devices.revoked_at`.
- Confirm revoked-device refresh returns invalid grant.
- Confirm no direct upstream-provider brand string is present in tracked source or docs.
