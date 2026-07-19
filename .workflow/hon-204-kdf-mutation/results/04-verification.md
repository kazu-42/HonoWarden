# Packet 04 result: verification in progress

Recorded at: `2026-07-19`

Passed fourth-remediation checks:

- focused prelogin/repository/app suite: red at 8 failures, then green at 3
  files and 311 tests
- ops lifecycle contract: red before report/check integration, then green at 1
  test and 18 lifecycle checks; the final combined focused run passed 4 files
  and 312 tests in 10.33 seconds
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm cf:typegen` with no generated diff
- `pnpm test`: 86 files, 1,045 tests in 62.00 seconds
- `pnpm compat:test`: 3 files, 101 tests
- `pnpm account:kdf-change:lifecycle`: 18 lifecycle checks
- `pnpm release:gate`: overall ready, 11 pass, 0 manual, 0 block
- `pnpm brand:scan`
- `git diff --check`
- workflow verifier

The focused tests prove that a single read snapshot supplies both the exact
known-account KDF and a count-weighted stored population for unknown decoys.
They cover readable legacy PBKDF values, non-preset current values, observed
resource bounds, stable selection independent of row order, empty-database
fallback, and fail-closed malformed or inconsistent contexts. The real local
D1 lifecycle proves the unknown response tracks the sole stored generation
before and after mutation.

During the second remediation, the first full-suite attempt passed 1,038 of
1,039 tests but an unrelated
staging bundle test exceeded its 15-second timeout under parallel load. That
test passed alone in 8.31 seconds, and an immediate full `pnpm test` rerun
passed all 1,039 tests in 200.11 seconds. No timeout is waived.

Four standard review passes found one P1 rollout defect, two P2 client
compatibility/enumeration defects, one P2 finite-decoy defect, and then three
P2 distribution/legacy/resource-cost defects in the complete-range decoy. The
stored-population remediation passes every check above. A clean exact-head
standard review and the independent five-axis review remain pending and are not
represented as passed here.
