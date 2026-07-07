# Packet 04: Verification

## Objective

Prove the workflow definition is safe to commit.

## Checks

- focused release tag workflow test
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push
