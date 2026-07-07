# Week 26 Release Published Packet

## Goal

Add a read-only packet that verifies the `v0.1.0-alpha` GitHub Release after it
is published, without publishing the release or deploying from it.

## Success Criteria

- A package script exposes the published packet.
- The packet verifies local tag context, remote tag context, tag verification
  workflow evidence, release gate readiness, published prerelease state, target
  commit, and release-note body sections.
- The packet fails while the release is still a draft.
- Tests cover published success, draft blocking, and strict failure without tag
  workflow evidence.
- Docs require the published packet after release publication.

## Current Context

- `v0.1.0-alpha` points at
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- Release Tag Verification run `28863312935` passed for that commit.
- A draft prerelease exists for `v0.1.0-alpha`.
- Release publication remains an approval-gated external write.

## Constraints

- Do not publish the GitHub Release in this workflow.
- Do not create, update, delete, or move tags.
- Do not deploy, change DNS, or change email routing.
- Keep the external compatibility brand name out of code and docs.

## Risks

- Treating a draft as published would create false release evidence.
- Verifying current branch `HEAD` instead of the tag commit would drift after
  `main` advances.
- Deployment must remain separate from release publication.

## Approval Required

No approval is required for this read-only implementation. Explicit operator
approval is still required before release publication or deployment.

## Work Packets

1. Published verifier contract and tests.
2. Packet implementation and package script.
3. Docs and workflow integration.
4. Verification and handoff.

## Integration Policy

Keep this slice scoped to post-publication evidence. Do not change runtime API
behavior, migrations, deployment config, the release tag, or the draft release
itself.

## Verification

- `pnpm exec vitest run test/ops/release-published-packet.test.ts`
- `pnpm exec vitest run test/release-docs.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow artifact verifier

## Reusable Artifacts

Use the packet immediately after publication and before any deployment approval
discussion.
