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
- `gh run view 28845655621 --repo kazu-42/HonoWarden --json databaseId,headSha,status,conclusion,url,workflowName`
- `gh run view 28846007803 --repo kazu-42/HonoWarden --json databaseId,headSha,status,conclusion,url,workflowName`

## CI

GitHub Actions CI is checked after pushing the final commit and reported in the
operator-facing response, not committed back into this artifact.
