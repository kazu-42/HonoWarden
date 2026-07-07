# Result 04: Verification

## Accepted

- Focused formatting and tests passed.
- Full typecheck, lint, tests, formatting, release gate, and brand scan passed.
- Workflow artifact verification passed.
- The real GitHub draft prerelease for `v0.1.0-alpha` failed closed in strict
  mode because `isDraft=true`; published verification requires `isDraft=false`.
- The release remains draft/prerelease and publication was not executed.

## Rejected

- Release publication remains outside this workflow until explicit operator
  approval is granted.

## Evidence

- `pnpm exec prettier --check scripts/honowarden-release-published-packet.mjs test/ops/release-published-packet.test.ts docs/release/tagging-runbook.md docs/current-state.md test/release-docs.test.ts package.json .workflow/week-26-release-published-packet/**/*.md .workflow/week-26-release-published-packet/state.json`
- `pnpm exec vitest run test/ops/release-published-packet.test.ts test/release-docs.test.ts`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-release-published-packet`
- `pnpm release:published:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
