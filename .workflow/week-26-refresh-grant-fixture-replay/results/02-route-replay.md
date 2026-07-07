# Result 02: Route Replay

Implemented locally:

- Added a deterministic `refreshSession` row in
  `test/compat/fixture-route-replay.test.ts`.
- Added `token/refresh-grant-success.json` to route replay with
  `allowMutatingFixtures: true`.
- Preserved the default mutating fixture guard.

Verification:

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts` passed: 1
  file, 22 tests.
