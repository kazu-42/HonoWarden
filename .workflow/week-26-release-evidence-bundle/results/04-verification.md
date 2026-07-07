# Result 04: Verification

## Local Checks

- `pnpm test -- test/ops/release-evidence-bundle.test.ts`
- `pnpm test -- test/release-docs.test.ts`
- `pnpm release:evidence:bundle -- --allow-dirty --ci-run-id 28846213680 --ci-url https://github.com/kazu-42/HonoWarden/actions/runs/28846213680`
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
