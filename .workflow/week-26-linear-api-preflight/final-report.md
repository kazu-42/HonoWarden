# Final Report: Week 26 Linear API Preflight

## Outcome

Implemented a local read-only Linear API preflight guard for future seed
application.

## Accepted Results

- Added `pnpm linear:preflight`.
- The script blocks missing API keys, malformed API keys, custom GraphQL
  endpoints including alternate ports, workspace environment mismatches,
  malformed seed workspace targets, malformed seed team targets, GraphQL/auth
  errors, workspace mismatch, team mismatch, missing team, and missing workflow
  state types from issues or seeded view filters.
- The report inventories matching seed projects, labels, documents, and views
  without printing the API key. Project-scoped views are separated into manual
  inventory because the root custom-view readback does not verify that scope.
- Docs now require `linear:preflight -- --strict` before Linear API writes.

## Rejected Results

- No live Linear writes were attempted.
- No importer was added in this slice; the guard comes first.

## Conflicts Resolved

None.

## Verification Evidence

- `pnpm linear:preflight` passed in non-strict mode with
  `blockingReason: "linear_api_key_missing"`, which is expected for the current
  local environment.
- `pnpm exec vitest run test/ops/linear-preflight.test.ts` passed: 13 tests.
- `pnpm linear:seed` passed.
- `pnpm test` passed after limiting Vitest worker concurrency: 46 files, 410
  tests.
- `pnpm check`, `pnpm lint`, `pnpm format`, `pnpm brand:scan`, and
  `pnpm release:gate -- --strict` passed.
- Workflow verifier passed for `.workflow/week-26-linear-api-preflight`.

## Remaining Risks

- `LINEAR_API_KEY` is still missing locally.
- The Linear MCP connector still points at an unrelated workspace.
- Applying labels/projects/views/issues remains a later explicit mutation step.
- Vitest now limits worker concurrency to avoid child-process-heavy ops tests
  timing out under local and CI load.

## Reusable Follow-up

Use `pnpm linear:preflight -- --strict` immediately before any future Linear
seed apply operation.
