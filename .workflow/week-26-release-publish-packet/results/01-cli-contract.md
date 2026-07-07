# Result 01: CLI Contract

## Accepted

- Added focused tests for ready output, non-draft blocking, and strict failure
  without tag workflow evidence.
- Tests assert that the ready packet includes passing checks, the existing
  draft prerelease metadata, publish command text, approval text, and a
  limitation stating that the packet does not publish a GitHub Release.

## Rejected

- No real GitHub commands are used by the tests.

## Evidence

- `pnpm exec vitest run test/ops/release-publish-packet.test.ts`
