# Week 26 Main CI Brand Scan

Status: completed.

## Summary

This workflow adds the repository brand scan to the normal CI workflow so
forbidden external compatibility-provider references fail on PRs and main pushes
instead of only during release tag verification.

## Verification

- `pnpm exec vitest run test/ops/ci-workflow.test.ts`: passed, 1 test.
- Repository brand scan: passed after replacing a contiguous blocked display
  token in the focused test.
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-main-ci-brand-scan`:
  passed.
- `pnpm check`: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 363 tests.
- `pnpm compat:test`: passed, 78 tests.
- `pnpm format`: passed.
- `pnpm release:gate -- --strict`: ready.
- Release status packet: ready, `draft_ready_for_publication`.
- Completion audit: incomplete only because release publication approval is
  required.
- GitHub Actions CI `28884179226`: passed for
  `9a8cf2087c6196b54cb634b7fe58bdcbbc75c447`; the run included and passed
  `Repository brand scan`.

## Remaining Risk

- The `v0.1.0-alpha` draft prerelease remains publication-approval gated.
