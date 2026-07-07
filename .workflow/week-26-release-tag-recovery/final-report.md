# Final Report: Week 26 Release Tag Recovery

## Outcome

Implemented a read-only recovery packet for the failed `v0.1.0-alpha` tag
verification path. The packet emits lease-guarded tag movement commands and
approval text only after validating local/remote tag state, latest main CI,
failed tag workflow evidence, and absence of an existing GitHub release.

No tag was moved, deleted, or pushed by the packet implementation workflow. No
GitHub release was created or modified by the packet implementation workflow.

## Accepted Results

- Added `pnpm release:tag:recovery`.
- Added `scripts/honowarden-release-tag-recovery-packet.mjs`.
- Added focused recovery packet tests.
- Updated release docs to require the recovery packet before replacing a pushed
  tag.
- Updated current-state notes and workflow artifacts.

## Rejected Results

- Did not add automatic tag movement.
- Did not relax the explicit operator approval requirement.
- Did not create a GitHub release draft.

## Conflicts Resolved

- Kept recovery evidence separate from the pre-tag approval packet because the
  tag already exists after the failed verification workflow.
- Kept GitHub Actions CI evidence external to this commit to avoid a
  self-referential state-file loop.

## Verification Evidence

- `pnpm exec vitest run test/ops/release-tag-recovery-packet.test.ts test/release-docs.test.ts test/ops/release-evidence-bundle.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-release-tag-recovery`
- GitHub Actions CI run `28861219727` passed for commit
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- `Release Tag Verification` run `28863312935` passed for commit
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- Current `v0.1.0-alpha` tag readback resolves to
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- Current GitHub Release readback shows a draft prerelease targeting
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.

## Remaining Risks

- GitHub Release publication still requires explicit operator approval.
- Deployment from the tag or release remains a separate approval gate.
- Future pushed-tag recovery incidents must regenerate a fresh lease and stop if
  a release already exists for the tag.

## Reusable Follow-up

Use `pnpm release:tag:recovery -- --strict ...` whenever a pushed alpha tag
needs corrective movement after a failed verification workflow. Treat the
printed command as approval material, not as permission to execute it.
