# Packet 02: Tests

## Objective

Prove the approval packet is read-only, strict about CI evidence, and aligned
with the selected remote.

## Files

- `test/ops/release-approval-packet.test.ts`
- `test/ops/alpha-tag-preflight.test.ts`
- `scripts/honowarden-alpha-tag-preflight.mjs`

## Do

- Use disposable temporary remotes.
- Assert the packet reports ready with allowed dirty state and local dry-run CI
  evidence.
- Assert strict mode fails without CI evidence.
- Assert remote-aware push commands match the checked remote.

## Do Not

- Depend on the real GitHub remote for focused tests.
- Create real tags or GitHub releases.

## Expected Output

Focused tests catch both missing CI evidence and remote command drift.
