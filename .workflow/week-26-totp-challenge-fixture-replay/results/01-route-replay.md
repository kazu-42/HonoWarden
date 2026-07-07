# Result 01: Route Replay

Implemented locally:

- Imported `encryptTotpSecret` in
  `test/compat/fixture-route-replay.test.ts`.
- Added a synthetic TOTP-enabled replay user with an encrypted synthetic TOTP
  secret.
- Added `token/totp-challenge.json` to route replay with
  `allowMutatingFixtures: true`.
- Preserved the default mutating fixture guard.

Verification:

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts` passed: 1
  file, 23 tests.
- `pnpm check` passed.
