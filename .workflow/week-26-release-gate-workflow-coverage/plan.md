# Week 26 Release Gate Workflow Coverage

## Goal

Expand release gate workflow evidence coverage to include the completed Week 26
release, tag, ops, and compatibility workflows that were added after the first
release gate.

## Success Criteria

- Release gate workflow evidence includes current Week 26 release preparation
  workflows through GitHub release planning.
- The gate accepts both legacy string CI evidence and structured CI evidence
  objects.
- Included workflow states are normalized to `completed` and `passed` with CI
  run evidence.
- Focused release gate tests, strict release gate, full local checks, brand
  scan, and workflow verifier pass.

## Current Context

- `pnpm release:gate -- --strict` is ready.
- The existing workflow evidence list stops before later Week 26 tag/release
  planning workflows.
- Several state files record successful local verification but lacked committed
  CI run evidence strings.

## Constraints

- Do not include this workflow in the release gate list to avoid a CI
  self-reference loop.
- Do not create or push a release tag.
- Do not create or publish a GitHub release.
- Do not introduce blocked external brand names.

## Risks

- Requiring the current workflow's own future CI evidence would make release
  gate CI impossible to pass.
- Mixing structured and string check entries can break naive CI evidence
  detection.
- Stale workflow evidence can make alpha readiness look narrower than the work
  actually completed.

## Approval Required

No approval required for local gate, tests, docs, and state evidence updates.
Approval is required before tag creation, tag push, release publication, or
deployment.

## Work Packets

- Gate logic: expand required workflow slugs and support structured CI evidence.
- State evidence: normalize completed Week 26 state files with CI run IDs.
- Tests and docs: assert representative expanded evidence and document current
  state.
- Verification: run local checks and CI.

## Integration Policy

This slice changes release readiness evidence only. It must not change runtime
API behavior, storage schema, deployment configuration, or external release
state.

## Verification

- `pnpm test -- test/ops/release-gate.test.ts`
- `pnpm release:gate -- --strict`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push

## Reusable Artifacts

Use this as the evidence-expansion pattern when adding future release workflows:
record CI evidence in the workflow state, then add the completed workflow to the
gate list after CI has passed.
