# Packet 02: Tests

## Objective

Prove the post-tag packet detects the important release safety invariants
without mutating the real repository or GitHub.

## Files

- `test/ops/post-tag-release-packet.test.ts`
- `test/release-docs.test.ts`

## Do

- Use fake `git` and `gh` binaries through a temporary `PATH`.
- Model an annotated remote tag with both tag object and peeled commit SHAs.
- Verify missing tag workflow evidence fails strict mode.
- Verify a wrong remote tag commit blocks readiness.

## Do Not

- Create real tags.
- Create, update, publish, or delete GitHub releases.
- Depend on live GitHub state for focused tests.

## Expected Output

Focused tests cover successful post-tag readiness, missing workflow evidence,
and remote tag mismatch.
