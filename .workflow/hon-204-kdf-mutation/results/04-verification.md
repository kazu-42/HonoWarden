# Packet 04 result: verification before exact-head review

Recorded at: `2026-07-19`

Passed checks:

- focused KDF/prelogin/app suite: 3 files, 307 tests
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`: 86 files, 1,039 tests
- `pnpm compat:test`: 3 files, 101 tests
- `pnpm account:kdf-change:lifecycle`: 17 lifecycle checks
- `pnpm vitest run test/ops/account-kdf-change-lifecycle.test.ts`: 1 test in
  36.63 seconds
- `pnpm release:gate`: overall ready, 11 pass, 0 manual, 0 block
- `pnpm brand:scan`
- `git diff --check`
- workflow verifier

The full suite includes focused parser, repository, route, prelogin, auth
repository, FakeD1, real local D1, compatibility replay, documentation, and
operations checks. It also proves the writer is state-free and default-off,
every tracked Wrangler environment remains false, the local lifecycle opts in
explicitly, and the rollback runbook preserves a reader-capable target.

The first full-suite attempt passed 1,038 of 1,039 tests but an unrelated
staging bundle test exceeded its 15-second timeout under parallel load. That
test passed alone in 8.31 seconds, and an immediate full `pnpm test` rerun
passed all 1,039 tests in 200.11 seconds. No timeout is waived.

Two standard review passes found one P1 rollout defect and then two P2 client
compatibility/enumeration defects. Both remediation rounds passed all checks
above. Standard exact-head re-review and the independent five-axis review
remain pending and are not represented as passed here.
