# Week 26 Release Gate Command Scope Coverage

## Goal

Make the alpha release gate prove that repo-scoped GitHub Release command
generation is part of the verified Week 26 evidence set.

## Success Criteria

- `pnpm release:gate -- --strict` requires
  `.workflow/week-26-release-command-repo-scope/state.json`.
- The required workflow state includes passed GitHub Actions CI evidence.
- Release gate tests assert the new workflow evidence path.
- Documentation records the coverage and keeps publication/deploy out of scope.
- No GitHub Release publication, deployment, DNS, or email routing write occurs.

## Current Context

- `v0.1.0-alpha` already has a draft prerelease targeting
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- The previous command-scope workflow was pushed as commit `4eb6ee1` and CI run
  `28865791573` passed.
- Release publication still requires explicit operator approval.

## Constraints

- Keep external compatibility brand names out of repository-controlled text.
- Do not publish the GitHub Release.
- Do not deploy from the tag or release.
- Do not mutate DNS, email routing, secrets, tags, or Cloudflare resources.

## Risks

- Adding a workflow to the release gate without CI evidence would make the gate
  fail correctly but block alpha readiness.
- Making this workflow self-referential would require a future CI run before the
  current change can pass, so this coverage workflow is documented separately.

## Approval Required

No extra approval is required for local scripts, tests, docs, workflow
artifacts, commits, pushes, and CI. Publication, deployment, DNS, email routing,
secrets, and tag mutation remain separately approval-gated.

## Work Packets

- `01-gate`: add the command-scope workflow to release gate evidence.
- `02-docs-state`: update current-state and workflow state evidence.
- `03-verification`: run targeted checks, release gate, brand scan, and CI.

## Integration Policy

Keep the change limited to release gate evidence and documentation. If the gate
fails, inspect the workflow state evidence before changing the gate semantics.

## Verification

- `pnpm exec vitest run test/ops/release-gate.test.ts`
- `pnpm release:gate -- --strict`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-release-gate-command-scope-coverage`
- repository brand scan
- full local checks before push
- GitHub Actions CI after push

## Reusable Artifacts

The release gate evidence pattern remains in
`scripts/honowarden-release-gate.mjs` and `test/ops/release-gate.test.ts`.
