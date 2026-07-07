# Result 04: Verification

## Local Checks

- `pnpm test -- test/release-docs.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier

## Notes

- GitHub Actions CI is checked after pushing the commit.
