# Packet 04: Verification

## Objective

Prove the release planning slice is safe to commit.

## Checks

- focused GitHub release plan tests
- release plan smoke
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push
