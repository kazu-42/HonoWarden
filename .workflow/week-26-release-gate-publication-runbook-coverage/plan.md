# Week 26 Release Gate Publication Runbook Coverage

## Goal

Make the alpha release gate require the completed publication gate runbook
workflow evidence.

## Success Criteria

- `pnpm release:gate -- --strict` requires
  `.workflow/week-26-publication-gate-runbook/state.json`.
- The publication gate runbook workflow state is `completed` and includes passed
  GitHub Actions CI evidence.
- Release gate tests assert the new workflow evidence path.
- Documentation records the coverage without claiming publication or deployment
  happened.
- No GitHub Release publication, deployment, DNS, email routing, tag, secret, or
  Cloudflare resource write occurs.

## Current Context

- `docs/release/publication-gate.md` was added in commit `6ae6513`.
- GitHub Actions CI run `28866583897` passed for that commit.
- The GitHub Release remains a draft prerelease targeting
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.

## Constraints

- Keep external compatibility brand names out of repo-controlled text.
- Do not publish the GitHub Release.
- Do not deploy from the tag or release.
- Do not mutate DNS, email routing, secrets, tags, or Cloudflare resources.

## Risks

- Adding a workflow to the gate before recording CI evidence would correctly
  block the release gate.
- Self-referentially requiring this coverage workflow would force a future CI
  run before the current change can pass, so this workflow remains documented
  but not required by its own gate change.

## Approval Required

No extra approval is required for local scripts, tests, docs, workflow
artifacts, commits, pushes, and CI. Release publication and deployment remain
separately approval-gated.

## Work Packets

- `01-gate`: require the publication gate runbook workflow in release gate.
- `02-state-docs`: record CI evidence and current-state coverage.
- `03-verification`: run targeted checks, release gate, status packet, full
  checks, push, CI, and release readback.

## Integration Policy

Keep the change limited to release gate evidence and workflow state. If the gate
fails, inspect the required workflow state before changing gate semantics.

## Verification

- `pnpm exec vitest run test/ops/release-gate.test.ts`
- `pnpm release:gate -- --strict`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- workflow verifier
- full local checks before push
- GitHub Actions CI after push
- GitHub Release draft readback

## Reusable Artifacts

The release gate workflow evidence pattern remains in
`scripts/honowarden-release-gate.mjs` and `test/ops/release-gate.test.ts`.
