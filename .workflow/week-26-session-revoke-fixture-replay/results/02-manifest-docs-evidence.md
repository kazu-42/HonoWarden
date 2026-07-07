# Result 02: Manifest Docs Evidence

## Accepted

- Added `session_revoke` to `compat/fixture-flows.json`.
- Added `session_revoke` to all client matrix `coveredFlows` lists.
- Updated matrix tests and compatibility matrix docs.
- Updated `docs/current-state.md` to record session revoke route replay coverage.

## Verification Evidence

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts`
  - 1 test file passed
  - 35 tests passed
- `pnpm exec vitest run test/compat`
  - 3 test files passed
  - 76 tests passed
- `pnpm check`
  - passed
- `pnpm lint`
  - passed
- `pnpm test`
  - 40 test files passed
  - 360 tests passed
- `pnpm format`
  - passed
- repository policy external-brand scan
  - passed
- workflow verifier
  - passed
- `pnpm release:gate -- --strict`
  - passed with `overall: ready`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
  - passed with `phase: draft_ready_for_publication`
- `pnpm release:completion:audit -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
  - returned `completion: incomplete`
  - blocking reason remains `release_publication_approval_required`

## Pending

- GitHub Actions readback after push.
