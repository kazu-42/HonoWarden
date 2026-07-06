# Packet 01 Result: Dry Run Script

Implemented `scripts/honowarden-staging-dry-run.mjs` and package script
`pnpm staging:dry-run`.

The script:

- runs `pnpm wrangler deploy --env staging --dry-run --outdir ...`
- validates staging Worker, D1, R2, environment, bootstrap, audit, and
  staging/production separation settings
- records generated bundle path, bytes, and SHA-256
- reports placeholder D1 IDs and lack of remote deploy/resource mutation as
  limitations

Targeted verification:

- `pnpm test -- test/ops/staging-dry-run.test.ts test/ops/release-gate.test.ts`
  passed.
- Manual probe produced a passing dry-run report with a generated Worker bundle.
