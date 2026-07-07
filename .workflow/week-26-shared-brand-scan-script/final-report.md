# Week 26 Shared Brand Scan Script

Status: completed.

## Summary

This workflow centralizes the repository brand scan so normal CI, release tag
verification, and local verification use one package script.

## Verification

- Spark implementation reviewed locally.
- `pnpm exec vitest run test/ops/brand-scan.test.ts test/ops/ci-workflow.test.ts test/ops/release-tag-workflow.test.ts`:
  passed, 5 tests.
- `pnpm brand:scan`: passed.
- Prior `rg` repository brand scan command: passed.
- Workflow verifier: passed.
- `pnpm check`: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 366 tests.
- `pnpm compat:test`: passed, 78 tests.
- `pnpm format`: passed.
- `pnpm release:gate -- --strict`: ready.
- Release status packet: ready, `draft_ready_for_publication`.
- Completion audit: incomplete only because release publication approval is
  required.
- GitHub Actions CI `28884616447`: passed for
  `7ecc4ae42deb9f6ef0b677fce9c59b6fcdbca1a2`; the run included and passed
  `Repository brand scan` via `pnpm brand:scan`.

## Remaining Risk

- The `v0.1.0-alpha` draft prerelease remains publication-approval gated.
