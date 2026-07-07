# Week 26 Release Gate Status Packet Coverage

## Goal

Expand release gate workflow evidence so the completed release status packet
workflow is required before alpha release state reporting is considered fully
covered.

## Success Criteria

- `scripts/honowarden-release-gate.mjs` requires
  `week-26-release-status-packet`.
- The included workflow state records passed GitHub Actions CI run evidence.
- Release gate tests assert the new workflow evidence path.
- Strict release gate, full local checks, brand scan, workflow verifier, and CI
  pass.

## Current Context

- `week-26-release-status-packet` passed GitHub Actions CI run `28865069916`.
- The current coverage workflow cannot require its own future CI evidence.
- The GitHub Release remains a draft prerelease.

## Constraints

- Do not publish the GitHub Release.
- Do not create, update, delete, or move tags.
- Do not deploy, change DNS, or change email routing.
- Keep the external compatibility brand name out of code and docs.
- Do not include this current coverage workflow in `requiredWorkflowSlugs`.

## Risks

- Including this workflow in its own gate list would create a CI
  self-reference.
- Adding the status workflow without CI evidence would correctly make the
  release gate fail.

## Approval Required

No approval required for local gate, tests, docs, and workflow-state evidence
updates. Release publication and deployment remain approval-gated.

## Work Packets

1. Gate logic: expand required workflow slugs.
2. State evidence: record CI run ID for the newly included workflow.
3. Tests and docs: assert and document the new gate coverage.
4. Verification and handoff.

## Integration Policy

Keep this slice scoped to release gate evidence. Do not mutate tags, GitHub
Release state, deployment state, DNS, email routing, or runtime API behavior.

## Verification

- `pnpm exec vitest run test/ops/release-gate.test.ts`
- `pnpm release:gate -- --strict`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- repository brand scan
- workflow verifier
- `gh run view 28865069916`

## Reusable Artifacts

Use this as the pattern for adding completed release-prep workflows to the gate:
land the workflow first, observe CI, then add its state file and CI evidence to
`requiredWorkflowSlugs`.
