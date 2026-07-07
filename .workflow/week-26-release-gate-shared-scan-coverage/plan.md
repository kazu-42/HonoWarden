# Week 26 release gate shared scan coverage

## Goal

Make the alpha release gate require the completed release evidence shared brand
scan workflow as repository-local release evidence.

## Success Criteria

- `requiredWorkflowSlugs` includes
  `week-26-release-evidence-shared-brand-scan`.
- Release gate tests assert the new workflow state evidence path.
- Strict release gate remains ready.
- Local checks, workflow verifier, brand scan, and GitHub Actions CI pass.

## Current Context

- `week-26-release-evidence-shared-brand-scan` is completed and has passing CI
  evidence for run `28885961455`.
- The release gate currently stops at `week-26-alpha-completion-audit` in its
  required workflow evidence list.
- The `v0.1.0-alpha` draft prerelease is still publication-approval gated.

## Constraints

- Do not include this current coverage workflow in `requiredWorkflowSlugs`; only
  require the already completed shared-scan workflow.
- Do not publish releases, move tags, deploy, mutate DNS/email/Cloudflare
  resources, or touch secrets.
- Keep the external compatibility-provider brand token out of tracked content.

## Risks

- Adding a workflow without valid CI evidence would correctly make the release
  gate fail.
- Over-expanding the gate to include the current workflow would create a
  self-reference before this slice has CI evidence.

## Approval Required

No approval required for local release gate logic, tests, docs, workflow
artifacts, commit/push, and CI readback. Release publication remains separately
approval-gated.

## Work Packets

1. Spark gate implementation
   - Own `scripts/honowarden-release-gate.mjs` and
     `test/ops/release-gate.test.ts`.
2. Main docs, workflow, and verification
   - Own `docs/current-state.md` and
     `.workflow/week-26-release-gate-shared-scan-coverage/**`.

## Integration Policy

Keep the change limited to release gate workflow evidence coverage. If the gate
fails, inspect the newly required workflow state instead of weakening checks.

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

- `.workflow/week-26-release-gate-shared-scan-coverage`
