# Packet 04: Verification

## Objective

Prove the docs and gate change is safe to commit.

## Checks

- focused release docs test
- release gate strict
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push
