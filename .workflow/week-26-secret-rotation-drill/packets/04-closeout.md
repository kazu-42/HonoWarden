# Packet 04: Closeout

## Objective

Verify, publish, merge, and close the Linear issue.

## Scope

- Local verification commands
- GitHub PR and CI
- Linear `HON-60`

## Requirements

- Run narrow and full local checks before PR.
- Resolve CI failures before merge.
- Merge only after PR CI passes.
- Wait for main CI after merge.
- Update `HON-60` with PR URL, merge SHA, verification evidence, and remaining
  explicit boundaries.

## Verification

- PR CI passed.
- Main CI passed after merge.
- Linear issue moved to Done only after merge and main CI readback.
