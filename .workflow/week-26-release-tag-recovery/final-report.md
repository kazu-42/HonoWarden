# Final Report: Week 26 Release Tag Recovery

## Outcome

Implemented a read-only recovery packet for the failed `v0.1.0-alpha` tag
verification path. The packet emits lease-guarded tag movement commands and
approval text only after validating local/remote tag state, latest main CI,
failed tag workflow evidence, and absence of an existing GitHub release.

No tag was moved, deleted, or pushed in this workflow. No GitHub release was
created or modified.

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

## Remaining Risks

- The pushed `v0.1.0-alpha` tag still points at the failed verification commit
  until an operator approves a lease-guarded tag move.
- If the remote tag object changes before approval, the emitted lease command
  must be regenerated.
- If a GitHub release is created before recovery, tag movement needs a separate
  incident decision.

## Reusable Follow-up

Use `pnpm release:tag:recovery -- --strict ...` whenever a pushed alpha tag
needs corrective movement after a failed verification workflow. Treat the
printed command as approval material, not as permission to execute it.
