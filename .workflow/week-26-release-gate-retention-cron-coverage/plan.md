# Week 26 release gate retention cron coverage

## Goal

Make the alpha release gate require the completed retention cleanup Cron Trigger
workflow as repository-local release evidence.

## Success Criteria

- `requiredWorkflowSlugs` includes
  `week-26-retention-cleanup-cron-trigger`.
- Release gate tests assert the new workflow state evidence path.
- Strict release gate remains ready.
- Local checks, workflow verifier, brand scan, and GitHub Actions CI pass.

## Current Context

- `week-26-retention-cleanup-cron-trigger` is completed and has passing CI
  evidence for run `28886935393`.
- The completion commit also passed CI run `28887335445`.
- The release gate currently does not require the retention cleanup Cron Trigger
  workflow.
- The `v0.1.0-alpha` draft prerelease is still publication-approval gated.

## Constraints

- Do not include this current coverage workflow in `requiredWorkflowSlugs`; only
  require the already completed retention cleanup Cron Trigger workflow.
- Do not deploy, publish releases, move tags, mutate DNS/email/Cloudflare
  resources, or touch secrets.
- Keep tracked content free of the external compatibility-provider brand token.

## Risks

- Adding a workflow without valid CI evidence would correctly make the release
  gate fail.
- Adding the current coverage workflow would create a self-reference before this
  slice has CI evidence.

## Approval Required

No approval required for local release gate logic, tests, docs, workflow
artifacts, commit/push, and CI readback. Cloudflare deploy and release
publication remain separately approval-gated.

## Work Packets

1. Spark gate implementation
   - Own `scripts/honowarden-release-gate.mjs` and
     `test/ops/release-gate.test.ts`.
2. Main docs, workflow, and verification
   - Own `docs/current-state.md` and
     `.workflow/week-26-release-gate-retention-cron-coverage/**`.

## Integration Policy

Keep the change limited to release gate workflow evidence coverage. If strict
release gate fails, inspect the newly required workflow state instead of
weakening checks.

## Verification

- Focused release gate tests.
- Strict release gate.
- `pnpm brand:scan`
- workflow verifier
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- GitHub Actions CI readback

## Reusable Artifacts

- `.workflow/week-26-release-gate-retention-cron-coverage`
