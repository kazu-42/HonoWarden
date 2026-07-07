# Week 26 Release Status Packet

## Goal

Add a read-only release status packet that summarizes the current
`v0.1.0-alpha` release phase and next action without publishing the release.

## Success Criteria

- A package script exposes the status packet.
- The packet aggregates publish and published packet outputs.
- The packet reports a stable phase and next action:
  `draft_ready_for_publication`, `published_verified`,
  `published_not_verified`, or `not_ready_for_publication`.
- The packet emits publication approval text only when the draft is ready.
- Tests cover draft-ready, published-verified, published-not-verified, and
  strict not-ready states.
- Docs require the status packet in the release runbook.

## Current Context

- `v0.1.0-alpha` points at
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- Release Tag Verification run `28863312935` passed for that commit.
- A draft prerelease exists for `v0.1.0-alpha`.
- The publish packet is ready.
- Release publication remains an approval-gated external write.

## Constraints

- Do not publish the GitHub Release in this workflow.
- Do not create, update, delete, or move tags.
- Do not deploy, change DNS, or change email routing.
- Keep the external compatibility brand name out of code and docs.

## Risks

- Operators need a compact state readout now that there are multiple release
  packets.
- Status must not imply publication has happened while the release is still a
  draft.
- Status must not emit mutation commands except as approval-gated text.

## Approval Required

No approval is required for this read-only implementation. Explicit operator
approval is still required before release publication or deployment.

## Work Packets

1. Status contract and tests.
2. Packet implementation and package script.
3. Docs and workflow integration.
4. Verification and handoff.

## Integration Policy

Keep this slice scoped to release status reporting. Do not mutate tags, GitHub
Release state, deployment state, DNS, email routing, or runtime API behavior.

## Verification

- `pnpm exec vitest run test/ops/release-status-packet.test.ts`
- `pnpm exec vitest run test/release-docs.test.ts`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier

## Reusable Artifacts

Use the status packet as the top-level release state readout before and after
publication.
