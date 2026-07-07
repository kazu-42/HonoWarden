# Week 26 Release Gate Packet Coverage

## Goal

Expand release gate workflow evidence so the completed release approval and
post-tag release packet workflows are required before alpha tagging.

## Success Criteria

- `requiredWorkflowSlugs` includes the completed release approval packet and
  post-tag release packet workflows.
- Both included workflow states record passed GitHub Actions CI run evidence.
- Release gate tests assert the new workflow evidence paths.
- Strict release gate, full local checks, brand scan, workflow verifier, and CI
  pass.

## Current Context

- `week-26-release-approval-packet` passed GitHub Actions CI run `28845655621`.
- `week-26-post-tag-release-packet` passed GitHub Actions CI run `28846007803`.
- The release gate evidence list currently stops at GitHub release planning.
- The current coverage workflow cannot require its own future CI evidence.

## Constraints

- Do not create or push `v0.1.0-alpha`.
- Do not create, update, publish, or delete a GitHub release.
- Do not deploy.
- Do not introduce blocked external brand strings.
- Do not include this current coverage workflow in `requiredWorkflowSlugs`.

## Risks

- Including this workflow in its own gate list would create a CI
  self-reference loop.
- Adding workflows without CI evidence would correctly make the release gate
  fail.
- Stale release gate evidence can understate the required pre-alpha controls.

## Approval Required

No approval required for local gate, tests, docs, and workflow-state evidence
updates. Tag, release, deploy, DNS, and email writes remain approval-gated.

## Work Packets

- Gate logic: expand required workflow slugs.
- State evidence: record passed CI run IDs in completed packet workflows.
- Tests and docs: assert coverage and document current state.
- Verification: run local checks and CI.

## Integration Policy

This slice changes release readiness evidence only. It must not mutate runtime
API behavior, release tags, GitHub releases, deployments, DNS, email routing, or
secrets.

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

Use this as the pattern for adding completed release-prep workflows to the gate:
land the workflow first, observe CI, then add its state file and CI evidence to
the release gate in a later commit.
