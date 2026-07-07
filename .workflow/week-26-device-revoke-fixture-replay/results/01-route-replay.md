# Result 01: Route Replay

## Accepted

- Added `devices/revoke-success.json` to route replay with explicit stateful
  replay opt-in.
- Exposed `deviceRevokeChanges` through the route replay database seed.
- Signed the synthetic replay token for `deviceReplayUser`, matching fixture
  owner `user-id`.
- Preserved the default mutating fixture guard.

## Evidence

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts`
  - 1 test file passed
  - 25 tests passed

## Notes

- The fixture request and response body remain unchanged.
