# Orchestration: Week 16 Dogfood Environment Readiness

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If Wrangler resource IDs remain placeholders, validate distinct names and fail-closed defaults but do not require live IDs.
- If a proposed check would require Cloudflare write access, convert it into a documented manual gate.
- If health response changes break existing tests, update tests only when the new field is additive and operationally useful.

## Packet Prompts

- `01-runtime-environment`
  - Objective: add runtime environment resolution and health visibility.
  - Files: `src/infra/environment.ts`, `src/app.ts`, `test/infra/environment.test.ts`, `test/app.test.ts`.
  - Verification: targeted tests and typecheck.
- `02-config-validation`
  - Objective: enforce staging/production config separation in tests.
  - Files: `test/wrangler-environments.test.ts`, `package.json`, `pnpm-lock.yaml` if a JSONC parser is added.
  - Verification: `pnpm test`.
- `03-dogfood-docs`
  - Objective: document Week 16 readiness without claiming live dogfood evidence.
  - Files: `specs/week-16-dogfood-environment-readiness.md`, `docs/dogfood-runbook.md`, `docs/current-state.md`.
  - Verification: docs review and brand scan.
- `04-verification`
  - Objective: prove the integrated slice is ready.
  - Files: workflow result/final report files only.
  - Verification: full local gates, workflow verification, brand scan, push, CI.

## Completion Audit

- Health responses include `environment`.
- Unknown environment values resolve to `development`.
- Staging and production worker/database/bucket names differ.
- Bootstrap defaults remain disabled for staging and production.
- Docs describe readiness, not completed dogfood.
- Full gates and CI pass.
