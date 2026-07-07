# Week 26 main CI brand scan

## Goal

Add the repository external-brand scan to the normal `main` CI workflow so PR
and push checks catch forbidden compatibility-provider references before release
tag verification.

## Success Criteria

- `.github/workflows/ci.yml` runs a `Repository brand scan` step.
- A focused workflow test fails if the main CI scan step or core CI checks are
  removed.
- The scan command avoids contiguous forbidden provider-brand literals in
  tracked files.
- Local checks, workflow verification, read-only release readiness audits, and
  GitHub Actions CI pass.

## Current Context

- `.github/workflows/release-tag.yml` already runs a split-pattern repository
  brand scan.
- `.github/workflows/ci.yml` currently runs typecheck, lint, tests,
  compatibility fixtures, release gate, and format, but not the brand scan.
- The `v0.1.0-alpha` release remains draft-publication approval gated.

## Constraints

- Do not add the forbidden external compatibility-provider brand word as a
  contiguous tracked string.
- Do not publish releases, move tags, deploy, mutate DNS/email/Cloudflare
  resources, or touch secrets.
- Spark may implement only the small workflow/test patch; main agent owns QA.

## Risks

- A literal blocked word in the workflow/test would make the scan fail.
- If the CI step differs from release-tag workflow semantics, the two gates can
  drift.

## Approval Required

No approval required for local CI/test/docs/workflow edits and normal push/CI
verification. Release publication remains separately approval-gated.

## Work Packets

1. Spark implementation packet
   - Own `.github/workflows/ci.yml` and `test/ops/ci-workflow.test.ts`.
   - Add main CI brand scan and focused workflow test.
2. Main integration and evidence packet
   - Own docs and `.workflow/week-26-main-ci-brand-scan/**`.
   - Verify, commit, push, and record CI evidence.

## Integration Policy

Keep the main CI scan command aligned with release-tag workflow. Review the
Spark patch before running broad verification.

## Verification

- Focused workflow test.
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- release gate/status/completion audit
- GitHub Actions CI readback

## Reusable Artifacts

- `.workflow/week-26-main-ci-brand-scan`
