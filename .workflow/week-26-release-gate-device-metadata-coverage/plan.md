# Week 26 release gate device metadata coverage

## Goal

Make the alpha release gate require the completed device metadata update API
workflow as repository-local release evidence.

## Success Criteria

- `requiredWorkflowSlugs` includes `week-26-device-metadata-update-api`.
- Release gate tests assert
  `.workflow/week-26-device-metadata-update-api/state.json`.
- The current coverage workflow is not added to the release gate.
- Strict release gate remains ready.
- Local checks, workflow verifier, brand scan, commit/push, and GitHub Actions
  CI pass.

## Current Context

- `week-26-device-metadata-update-api` is completed and has passing CI evidence
  for run `28888487458`.
- The completion commit `4e47b36593ee787e7dac1271bf6c5e412b7c45ef` also
  passed CI run `28888567251`.
- The release gate currently does not require the device metadata workflow.
- The alpha draft release remains publication-approval gated.

## Constraints

- Do not add this current coverage workflow to the gate.
- Do not publish releases, deploy, move tags, mutate DNS/email/Cloudflare,
  write Linear, touch secrets, or use production data.
- Keep tracked content free of the external provider brand token.

## Risks

- Adding a workflow without valid CI evidence would correctly make the release
  gate fail.
- Adding this coverage workflow would create a self-reference before this slice
  has its own CI evidence.

## Approval Required

No approval required for local release gate logic, tests, docs, workflow
artifacts, commit/push, and CI readback. External writes remain separately
approval-gated.

## Work Packets

1. Spark gate implementation
   - own `scripts/honowarden-release-gate.mjs` and
     `test/ops/release-gate.test.ts`.
2. Main docs, workflow, verification
   - own `docs/current-state.md` and
     `.workflow/week-26-release-gate-device-metadata-coverage/**`.

## Integration Policy

Keep this slice limited to release gate workflow evidence coverage. If strict
release gate fails, inspect the newly required workflow state instead of
weakening checks.

## Verification

- Focused release gate tests.
- Strict release gate.
- Workflow verifier.
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm brand:scan`
- `pnpm test`
- `pnpm compat:test`
- Read-only release status and completion audit packets.
- GitHub Actions CI readback.

## Reusable Artifacts

- `.workflow/week-26-release-gate-device-metadata-coverage`
