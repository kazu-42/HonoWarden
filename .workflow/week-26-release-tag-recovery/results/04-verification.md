Result ID: 04-verification
Status: completed

Local verification completed:

- `pnpm exec vitest run test/ops/release-tag-recovery-packet.test.ts test/release-docs.test.ts test/ops/release-evidence-bundle.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-release-tag-recovery`

External readback after the separately approved recovery:

- GitHub Actions CI run `28861219727` passed for commit
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- `Release Tag Verification` run `28863312935` passed for commit
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- Local and remote `v0.1.0-alpha` now resolve to
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- The GitHub Release remains a draft prerelease targeting
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.

Still required:

- GitHub Release publication approval.
- Deployment, DNS, and email routing approvals before any live operations.
