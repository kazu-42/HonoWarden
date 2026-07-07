# Result 01: Route Replay

## Accepted

- Added `folders/create-success.json`, `folders/update-success.json`, and
  `folders/delete-success.json` to route replay with explicit stateful replay
  opt-in.
- Exposed `folderUpdateChanges` and `folderDeleteChanges` through the route
  replay database seed.
- Preserved the default mutating fixture guard.

## Evidence

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts`
  - 1 test file passed
  - 28 tests passed

## Notes

- Fixture request and response bodies remain unchanged.
