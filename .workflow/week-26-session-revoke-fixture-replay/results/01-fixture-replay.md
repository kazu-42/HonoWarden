# Result 01: Fixture Replay

## Accepted

- Added `devices/revoke-all-success.json` for successful revoke-all session
  response coverage.
- Added route replay with explicit stateful replay opt-in.
- Used fixed system time and token `iat`/`exp` claims so recent-auth validation
  is deterministic.
- Preserved the default mutating fixture guard.

## Evidence

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts`
  - 1 test file passed
  - 35 tests passed
- `pnpm exec vitest run test/compat`
  - 3 test files passed
  - 76 tests passed

## Notes

- This adds fixture-only coverage. It does not claim live client evidence for
  revoke-all.
