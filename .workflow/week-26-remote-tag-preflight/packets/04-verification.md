# Packet 04: Verification

## Objective

Prove the read-only remote-check slice is safe to commit.

## Checks

- focused alpha tag preflight test
- focused release docs test
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:tag:preflight -- --strict --check-remote`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push
