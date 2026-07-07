# Result 01: Route Replay Invariant

Status: completed locally.

Changes:

- Added `covers every fixture file exactly once` to
  `test/compat/fixture-route-replay.test.ts`.
- Added recursive Node filesystem discovery for `compat/fixtures/**/*.json`.
- Added duplicate, missing-file, and missing-replay assertions.
- Added manifest alignment assertion against `compat/fixture-flows.json`.

Evidence:

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts`: 1 file, 37
  tests passed.
- `pnpm exec vitest run test/compat`: 3 files, 78 tests passed.
