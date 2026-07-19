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

## Fifth Remediation Rerun

- focused TDD: five new failures, then 3 files and 314 tests passed
- combined focused suite: 4 files and 315 tests passed in 11.84 seconds
- standalone real local D1 lifecycle: all 18 checks passed
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm cf:typegen` with no generated diff
- `pnpm test`: 86 files and 1,048 tests passed in 62.26 seconds
- `pnpm compat:test`: 3 files and 101 tests passed
- `pnpm release:gate`: overall ready, 11 pass, 0 manual, 0 block
- `pnpm brand:scan`
- `git diff --check`
- workflow verifier

The new regressions prove that notification transport failure cannot turn a
committed KDF change into a client-visible failure, an invalid exact target still
fails closed, and unrelated invalid population rows cannot cause a fleet-wide
allowed-prelogin outage.

## Sixth Remediation Rerun

- focused TDD: a stalled Durable Object kept the response pending before the
  fix, then the regression passed after cleanup moved to `waitUntil`
- combined focused suite: 5 files and 378 tests passed
- `pnpm test`: 86 files and 1,049 tests passed in 47.31 seconds
- standalone real local D1 lifecycle: all 18 checks passed
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm cf:typegen` with no generated diff
- `pnpm compat:test`: 3 files and 101 tests passed
- `pnpm release:gate`: overall ready, 11 pass, 0 manual, 0 block
- `pnpm brand:scan`
- `git diff --check`
- workflow verifier

The new regression uses a deferred notification cleanup promise and proves the
HTTP 200 response settles before that promise is released. The explicit
transport-rejection regression still proves the redacted operational error is
emitted without changing the committed response.

## Seventh Remediation Rerun

- focused TDD: one regression failed because a never-settling Durable Object
  kept the `waitUntil` promise unresolved, then passed after the deadline fix
- full app suite: 271 tests passed
- `pnpm test`: 86 files and 1,050 tests passed in 41.05 seconds
- standalone real local D1 lifecycle: all 18 checks passed
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm cf:typegen` with no generated diff
- `pnpm compat:test`: 3 files and 101 tests passed
- `pnpm release:gate`: overall ready, 11 pass, 0 manual, 0 block
- `pnpm brand:scan`
- `git diff --check`
- workflow verifier

The new regression proves that notification cleanup reaches a deterministic
failure within the application-owned 10-second deadline, aborts the same
outbound request, and emits the existing redacted operational event. KDF still
acknowledges the committed generation immediately; password and security-stamp
cleanup retain their fail-loudly response contract with a bounded wait.

## Eighth Remediation Rerun

- focused TDD: the lifecycle contract failed on the missing reverse routes,
  second audit row, and revision readback, then passed after the runner covered
  the complete round trip
- combined focused suite: 6 files and 380 tests passed in 12.29 seconds
- standalone real local D1 lifecycle: all 36 checks passed
- `pnpm test`: 86 files and 1,050 tests passed in 42.67 seconds
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm cf:typegen` with an unchanged generated-file SHA-256
- `pnpm compat:test`: 3 files and 101 tests passed
- `pnpm release:gate`: overall ready, 11 pass, 0 manual, 0 block
- `pnpm brand:scan`
- `git diff --check`
- workflow verifier

The lifecycle now runs PBKDF2-to-Argon2id, stops the Worker for direct D1
readback, restarts from the same local persistence, and runs
Argon2id-to-PBKDF2. It proves both revision advances, both security-stamp
rotations, both prior device/refresh generation revocations, both audit rows,
final PBKDF2 projections, and byte-identical encrypted vault data. Broad
repository verification is green. Both exact-head reviews remain pending on
this candidate and are not represented as passed here.
