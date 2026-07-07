# Week 26 Release Publish Packet

## Goal

Add a read-only packet that verifies the `v0.1.0-alpha` draft prerelease is
safe to publish and emits the exact publish approval text and command without
publishing it.

## Success Criteria

- A package script exposes the publish packet.
- The packet verifies local tag context, remote tag context, tag verification
  workflow evidence, release gate readiness, draft release state, target
  commit, prerelease status, and release-note body sections.
- The packet emits a publish command only when every check passes.
- Tests cover ready output, non-draft release blocking, and strict failure
  without tag workflow evidence.
- Docs require the publish packet before release publication.

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

- Publishing makes the release visible and not merely staged as a draft.
- Publishing with the wrong target commit would misrepresent the tagged code.
- Publishing without prerelease status could imply broader stability than the
  alpha evidence supports.

## Approval Required

Explicit operator approval is required before running the printed publish
command.

## Work Packets

1. CLI contract and tests.
2. Packet implementation and package script.
3. Docs and workflow integration.
4. Verification and handoff.

## Integration Policy

Keep this slice scoped to release publication evidence. Do not change runtime
API behavior, migrations, deployment config, the release tag, or the draft
release itself.

## Verification

- `pnpm test -- test/ops/release-publish-packet.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow artifact verifier

## Reusable Artifacts

Use the packet for future prerelease publication gates after the draft release
has been created and verified.
