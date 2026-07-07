# Result 04: Verification

## Local Checks

- `pnpm test -- test/ops/alpha-tag-preflight.test.ts`
- `pnpm release:tag:preflight -- --allow-dirty --allow-existing-tag`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan

## Notes

- The local tag preflight smoke used `--allow-dirty` because this workflow was
  still being edited.
- A final clean strict tag preflight can only pass after these changes are
  committed and the working tree is clean.
- GitHub Actions CI is checked after pushing the commit.
