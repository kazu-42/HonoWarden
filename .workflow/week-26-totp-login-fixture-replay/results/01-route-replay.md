# Result 01: Route Replay

## Accepted

- Added `token/totp-login-success.json` to route replay with explicit
  stateful replay opt-in.
- Seeded a synthetic TOTP-enabled user and a device-bound challenge matching
  `synthetic-two-factor-token` under the fixture token secret.
- Scoped fake system time to the TOTP login fixture only and restored real
  timers in `finally`.
- Preserved the default mutating fixture guard.

## Evidence

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts`
  - 1 test file passed
  - 24 tests passed

## Notes

- The fixture request body remains unchanged; deterministic time is supplied by
  the replay harness.
