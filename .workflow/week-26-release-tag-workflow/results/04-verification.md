# Result 04: Verification

## Local Checks

- `pnpm test -- test/ops/release-tag-workflow.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier

## Notes

- Tag push CI is verified only after the tag is actually pushed; this slice
  verifies the workflow definition through main CI.
