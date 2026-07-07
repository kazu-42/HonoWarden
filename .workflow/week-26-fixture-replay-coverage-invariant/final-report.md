# Week 26 Fixture Replay Coverage Invariant

Status: local verification passed; GitHub Actions evidence pending.

## Summary

The fixture route replay suite now protects against fixture coverage drift. It
recursively enumerates every JSON fixture under `compat/fixtures`, requires a
matching `replayFixtures` entry exactly once, rejects replay paths that point to
no fixture file, and compares the route replay set with
`compat/fixture-flows.json`.

Documentation now reflects that CI route-replays every current fixture against
the Hono app, not only selected stateless fixtures.

## Verification

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts`: passed, 37
  tests.
- `pnpm exec vitest run test/compat`: passed, 78 tests.
- `pnpm check`: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 362 tests.
- `pnpm format`: passed.
- External compatibility brand scan: passed.

## Remaining Risk

- GitHub Actions CI still needs to pass on the pushed implementation commit.
- The `v0.1.0-alpha` draft prerelease remains publication-approval gated.
