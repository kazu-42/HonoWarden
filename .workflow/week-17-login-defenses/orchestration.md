# Orchestration: Week 17 Login Defenses

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If a defense would reveal account existence, keep the existing generic token error body.
- If IP address extraction is ambiguous, use `unknown` as the bucket source and still hash it.
- If a live-D1 migration step is needed, stop at docs/runbook and do not execute it in this local slice.

## Packet Prompts

- `01-defense-domain`
  - Objective: implement pure policy helpers for account lockout and IP buckets.
  - Files: `src/domain/login-defense.ts`, `test/domain/login-defense.test.ts`.
  - Verification: targeted unit tests.
- `02-schema-repository`
  - Objective: add D1 schema and repository operations for login defenses.
  - Files: `migrations/0002_login_defenses.sql`, `src/repositories/auth-repository.ts`, repository/FakeD1/migration tests.
  - Verification: repository and migration tests.
- `03-route-integration`
  - Objective: integrate defense checks into password grant flow.
  - Files: `src/app.ts`, `test/app.test.ts`.
  - Verification: app route tests.
- `04-docs-verification`
  - Objective: update Week17 docs and prove the integrated slice.
  - Files: docs/spec/workflow result files.
  - Verification: full gates, brand scan, workflow verification, CI.

## Completion Audit

- Wrong password increments account failure state.
- Success resets account failure state.
- Locked account receives generic invalid-grant response.
- IP rate limit uses hashed buckets and returns `429` with `Retry-After`.
- Unknown users and locked users do not reveal account existence.
- Full gates and CI pass.
