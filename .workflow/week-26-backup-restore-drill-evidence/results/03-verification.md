# Result 03: Verification

## Accepted

- `pnpm release:gate` passed and reported `not_ready` with 7 pass and 3 block.
- Targeted release gate and release docs tests passed.
- `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and
  `pnpm format` passed.
- Repository brand scans passed for content and paths.
- Workflow verifier passed.
- GitHub Actions CI run `28800000201` passed, including the release gate
  preflight step.

## Rejected

- Did not run remote Cloudflare backup/restore or strict release gate in CI.
