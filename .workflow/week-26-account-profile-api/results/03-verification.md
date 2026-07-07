# Result 03: Verification

Status: passed locally.

Checks:

- `pnpm exec vitest run test/app.test.ts test/compat/client-matrix.test.ts test/compat/compat-fixtures.test.ts`:
  passed, 3 files and 124 tests.
- `pnpm check`: passed.
- Workflow verifier: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 39 files and 294 tests.
- `pnpm format`: passed.
- `pnpm release:gate -- --strict`: passed, `overall: "ready"`.
- `pnpm release:status:packet -- --strict ...`: passed,
  `phase: "draft_ready_for_publication"`.
- Repository brand scan: passed.

External state:

- The GitHub Release remains a draft prerelease.
- Publication still requires the exact approval text emitted by the status
  packet.
