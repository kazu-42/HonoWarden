# Result 04: Verification

## Local Checks

- `pnpm test -- test/ops/release-approval-packet.test.ts`
- `pnpm test -- test/ops/alpha-tag-preflight.test.ts`
- `pnpm release:approval:packet -- --allow-dirty --ci-run-id 28845145150 --ci-url https://github.com/kazu-42/HonoWarden/actions/runs/28845145150`
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
