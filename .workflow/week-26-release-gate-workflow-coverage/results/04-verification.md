# Result 04: Verification

## Local Checks

- `pnpm test -- test/ops/release-gate.test.ts`
- `pnpm release:gate -- --strict`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- repository brand scan
- workflow verifier

## Notes

- GitHub Actions CI is checked after pushing the commit.
