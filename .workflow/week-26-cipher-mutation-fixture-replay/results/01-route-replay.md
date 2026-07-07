# Result 01: Route Replay

## Accepted

- Added route replay for cipher create, update, trash, restore, permanent
  delete, and stale revision conflict fixtures with explicit stateful replay
  opt-in.
- Exposed narrow cipher mutation-count seed knobs through the route replay
  database seed.
- Seeded folder ownership for create/update fixtures and a current cipher row
  for stale revision conflict.
- Aligned `DELETE /api/ciphers/:id` with the trash fixture while preserving
  `DELETE /api/ciphers/:id/delete` for permanent delete.
- Preserved the default mutating fixture guard.

## Evidence

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts test/app.test.ts -t "cipher|compatibility fixture route replay"`
  - 2 test files passed
  - 59 tests passed
- `pnpm compat:test`
  - 3 test files passed
  - 74 tests passed

## Notes

- Fixture request and response bodies remain unchanged.
