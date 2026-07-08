# Week 26 Linear apply plan final report

## Status

Implemented and locally verified.

## Accepted

- Local-only `pnpm linear:apply-plan`.
- Child-process tests for blocked, strict, ready, mismatch, custom seed, and
  no-network behavior.
- Seed fingerprint and inventory expected-name checks between preflight and
  apply-plan.
- Page-complete inventory checks before apply-plan classifies any seed object as
  create or confirm-existing.
- Resolved project-key dependencies for view operations.
- Apply-plan operation fields preserve the seed payload needed for later review
  or guarded Linear writes: issue descriptions and labels, view filters,
  document content, initiative metadata, and the first project update body.
- Operator docs that keep the live-write boundary explicit.

## Verification

Passed:

- `pnpm exec vitest run test/ops/linear-apply-plan.test.ts`
- `pnpm exec vitest run test/ops/linear-preflight.test.ts test/ops/linear-apply-plan.test.ts`
- `pnpm linear:apply-plan`
- `pnpm linear:apply-plan -- --strict` exits 1 while no preflight report is
  supplied
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- `pnpm linear:seed`
- `pnpm linear:preflight`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-linear-apply-plan`
- `git diff --check`

Local review:

- `codex review --uncommitted` found one payload-omission issue.
- The issue was fixed and covered by targeted apply-plan assertions.

## Remaining Risks

- `LINEAR_API_KEY` is still missing locally, so strict preflight cannot yet
  produce a ready report.
- The plan intentionally does not perform live writes.
- Future mutation support still needs a separate execute gate and write-scope
  evidence.
