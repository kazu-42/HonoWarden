# Result 04: Verification

## Local Checks

- `pnpm test -- test/ops/post-tag-release-packet.test.ts`
- `pnpm test -- test/release-docs.test.ts`
- `pnpm release:post-tag:packet -- --allow-missing-tag --allow-missing-remote-tag --allow-missing-tag-workflow`
- `pnpm release:post-tag:packet -- --strict` intentionally reports
  `not_ready` before tag creation
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier

## CI

GitHub Actions CI is checked after pushing the final commit and reported in the
operator-facing response, not committed back into this artifact.
