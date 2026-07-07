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

- GitHub Actions CI run `28846007803` passed after this workflow was pushed.
