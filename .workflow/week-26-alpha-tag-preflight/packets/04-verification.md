# Packet 04: Verification

## Objective

Prove the tag preflight is safe to commit and does not regress the alpha release
gate.

## Checks

- focused tag preflight tests
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- local tag preflight smoke
- repository brand scan
- workflow verifier
- GitHub Actions CI after push
