# Packet 03 Result: Verification

Initial verification before durable evidence recording:

- `pnpm test -- test/ops/staging-dry-run.test.ts test/ops/release-gate.test.ts`
  passed.
- `pnpm check` passed.
- `pnpm lint` passed after generated dry-run output was kept out of ESLint's
  scope.
- `pnpm format` passed.

Durable evidence recording:

- `pnpm staging:dry-run --out test/.tmp/staging-dry-run-evidence-20260706T145200Z/bundle --json test/.tmp/staging-dry-run-evidence-20260706T145200Z/report.json --require-clean`
  passed on clean source commit `2905151b874d8d78cc564cd65862bffb28c8958b`.
- `pnpm release:gate` reported `8 pass / 2 block`, with staging dry-run
  evidence passing and live-client plus Cloudflare resource evidence still
  blocked.
- `pnpm test -- test/ops/release-gate.test.ts test/release-docs.test.ts test/ops/staging-dry-run.test.ts`
  passed.
- Full local gates passed: `pnpm check`, `pnpm lint`, `pnpm test`,
  `pnpm compat:test`, and `pnpm format`.
- Repository brand content and path scans passed.
- Workflow verifier passed.
- GitHub Actions CI run `28801240561` passed.
