# Result 01: Route Replay

Implemented locally:

- Added `token/password-grant-success.json` to
  `test/compat/fixture-route-replay.test.ts`.
- The fixture is replayed with `allowMutatingFixtures: true`, keeping stateful
  replay explicit.
- The replay option builder now carries both per-fixture database seed and
  mutation opt-in options.
- The existing guard test still verifies that mutating fixtures are rejected by
  default.

Verification:

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts` passed: 1
  file, 21 tests.
