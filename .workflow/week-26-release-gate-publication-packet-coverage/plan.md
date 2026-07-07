# Week 26 Release Gate Publication Packet Coverage

## Goal

Expand release gate workflow evidence so the completed release publish and
published verification packet workflows are required before alpha publication
and post-publication verification are considered fully covered.

## Success Criteria

- `scripts/honowarden-release-gate.mjs` requires
  `week-26-release-publish-packet` and `week-26-release-published-packet`.
- Both included workflow states record passed GitHub Actions CI run evidence.
- Release gate tests assert the new workflow evidence paths.
- Strict release gate, full local checks, brand scan, workflow verifier, and CI
  pass.

## Current Context

- `week-26-release-publish-packet` passed GitHub Actions CI run `28864040079`.
- `week-26-release-published-packet` passed GitHub Actions CI run `28864381009`.
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
- Adding workflows without CI evidence would correctly make the release gate
  fail.

## Approval Required

No approval required for local gate, tests, docs, and workflow-state evidence
updates. Release publication and deployment remain approval-gated.

## Work Packets

1. Gate logic: expand required workflow slugs.
2. State evidence: record CI run IDs for the newly included workflows.
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
- `gh run view 28864040079`
- `gh run view 28864381009`

## Reusable Artifacts

Use this as the pattern for adding completed release-prep workflows to the gate:
land the workflow first, observe CI, then add its state file and CI evidence to
`requiredWorkflowSlugs`.
