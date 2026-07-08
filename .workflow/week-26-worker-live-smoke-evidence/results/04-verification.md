# Result 04: Verification

In progress.

Passed locally:

- `pnpm exec vitest run test/ops/ops-readiness-packet.test.ts test/release-docs.test.ts`
- `pnpm format`
- `pnpm check`
- `pnpm lint`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- `git diff --check`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-worker-live-smoke-evidence`
- `codex review --uncommitted`

Pending:

- PR CI
- merge readback
