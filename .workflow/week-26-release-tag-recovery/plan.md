# Week 26 Release Tag Recovery

## Goal

Make the failed `v0.1.0-alpha` tag verification recoverable through a
read-only, evidence-producing packet that emits lease-guarded tag move commands
but does not mutate local or remote tags.

## Success Criteria

- A package script exposes the recovery packet.
- The packet verifies the current remote tag object, peeled remote commit,
  local tag commit, latest main CI success, failed tag workflow evidence, and
  absence of a GitHub Release for the tag.
- The packet emits an exact approval text and `--force-with-lease` command for
  moving `v0.1.0-alpha` from the failed commit to the verified recovery commit.
- Tests cover the ready path, existing-release block, and missing-CI strict
  failure.
- Verification passes locally and in GitHub Actions before any tag move.

## Original Context

- `v0.1.0-alpha` was pushed as an annotated tag for
  `edbdc58163556b0928e58d6485e53172c4c6169a`.
- Release Tag Verification run `28850634073` failed.
- Main commit `e8fdfce46dd8228c14a8b77b79cac2ec9c0f2f7a` fixes the tag-workflow
  test isolation and annotated tag packet parsing issues.
- Main CI run `28851192055` passed for the recovery commit.
- No GitHub Release exists for `v0.1.0-alpha`.

## Current Readback

- `v0.1.0-alpha` now resolves to
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- Release Tag Verification run `28863312935` passed for that commit.
- The GitHub Release is a draft prerelease targeting
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- Publication and deployment remain separate approval gates.

## Constraints

- Do not move, delete, or push a tag in this workflow.
- Do not create, update, publish, or delete a GitHub Release.
- Keep the external compatibility brand name out of code and docs.
- Preserve the existing release approval-gate style.

## Risks

- A force-updated public tag can surprise downstream consumers.
- A stale lease could overwrite a tag that changed after evidence collection.
- Creating a release before retag recovery would make tag movement materially
  riskier.

## Approval Required

Explicit operator approval is required before any local tag replacement,
remote tag force update, release draft creation, release publication, deploy,
DNS change, or email routing change.

## Work Packets

1. CLI contract and tests for the read-only recovery packet.
2. Packet implementation and package script.
3. Docs/workflow integration.
4. Verification and recovery approval handoff.

## Integration Policy

Keep this slice scoped to release recovery evidence. Do not change runtime API
behavior, schema, deployment config, or release notes content except for
documenting the recovery packet.

## Verification

- `pnpm test -- test/ops/release-tag-recovery-packet.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan

## Reusable Artifacts

The recovery packet should be reusable for future alpha tag recovery incidents
by changing the expected failed commit, recovery commit, CI run, and failed tag
workflow run inputs.
