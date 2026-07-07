# Week 26 Release Gate Completion Audit Coverage

## Goal

Make the alpha release gate require the completed completion-audit workflow
evidence.

## Success Criteria

- `pnpm release:gate -- --strict` requires
  `.workflow/week-26-alpha-completion-audit/state.json`.
- The completion audit workflow state is `completed` and includes passed GitHub
  Actions CI evidence.
- Release gate tests assert the new workflow evidence path.
- Documentation records the coverage without claiming publication or deployment
  happened.
- No GitHub Release publication, deployment, DNS, email routing, tag, secret, or
  Cloudflare resource write occurs.

## Current Context

- `pnpm release:completion:audit` exists and reports the real current state as
  `completion: "incomplete"` with
  `blockingReason: "release_publication_approval_required"`.
- Commit `56b2be5` added the completion audit.
- GitHub Actions CI run `28867303505` passed for commit `56b2be5`.
- The GitHub Release remains a draft prerelease targeting
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.

## Constraints

- Keep external compatibility brand names out of repo-controlled text.
- Do not publish the GitHub Release.
- Do not deploy from the tag or release.
- Do not mutate tags, DNS, email routing, secrets, or Cloudflare resources.

## Risks

- Requiring a workflow before recording CI evidence would correctly block the
  release gate.
- This gate coverage proves the audit workflow is verified; it does not mean
  the alpha objective is complete while publication is still pending.
- Self-referentially requiring this coverage workflow would force a future CI
  run before the current change can pass.

## Approval Required

No extra approval is required for local scripts, tests, docs, workflow
artifacts, commits, pushes, and CI. Release publication and deployment remain
separately approval-gated.

## Work Packets

- `01-gate`: require the completion audit workflow in release gate.
- `02-state-docs`: record CI evidence and current-state coverage.
- `03-verification`: run targeted checks, release gate, completion audit, full
  checks, push, CI, and release readback.

## Integration Policy

Keep this change limited to release gate evidence and workflow state. If the
gate fails, inspect the completion-audit workflow state before changing gate
semantics.

## Verification

- `pnpm exec vitest run test/ops/release-gate.test.ts`
- `pnpm release:gate -- --strict`
- `pnpm release:completion:audit -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- workflow verifier
- full local checks before push
- GitHub Actions CI after push
- GitHub Release draft readback

## Reusable Artifacts

The release gate workflow evidence pattern remains in
`scripts/honowarden-release-gate.mjs` and `test/ops/release-gate.test.ts`.
