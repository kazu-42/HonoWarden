# Result 04: Verification

## Local Checks

- `pnpm test -- test/ops/github-release-plan.test.ts`
- `pnpm release:github:plan -- --allow-missing-tag --allow-missing-remote-tag --check-remote`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier

## Notes

- GitHub release writes remain approval-gated and were not performed.
