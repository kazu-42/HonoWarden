# Result 04: Verification

## Local Checks

- `pnpm test -- test/ops/alpha-tag-preflight.test.ts`
- `pnpm test -- test/release-docs.test.ts`
- `pnpm release:tag:preflight -- --allow-dirty --check-remote`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier

## Notes

- `pnpm release:tag:preflight -- --strict --check-remote` intentionally failed
  before commit because the working tree was dirty; the `remote_tag_absent`
  check itself passed.
- Run the clean strict remote-checked preflight after committing.
- GitHub Actions CI is checked after pushing the commit.
