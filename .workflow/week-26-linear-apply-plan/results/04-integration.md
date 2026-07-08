Result: completed

Local verification passed:

- `pnpm exec vitest run test/ops/linear-apply-plan.test.ts`
- `pnpm exec vitest run test/ops/linear-preflight.test.ts test/ops/linear-apply-plan.test.ts`
- `pnpm linear:apply-plan`
- `pnpm linear:apply-plan -- --strict`
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

Local review follow-up:

- `codex review --uncommitted` flagged that apply-plan operations dropped seed
  payload fields needed by a later Linear writer.
- The plan now preserves issue descriptions and labels, view filters, document
  content, initiative summary metadata, and first project update body.
- The targeted apply-plan test asserts the preserved payload fields.

Local review, PR, CI, and merge remain as the final publication steps.
