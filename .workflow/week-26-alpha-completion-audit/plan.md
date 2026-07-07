# Week 26 Alpha Completion Audit

## Goal

Add a read-only completion audit that makes the Week 26 alpha completion state
explicit and machine-checkable.

## Success Criteria

- `pnpm release:completion:audit` prints a JSON report.
- The report aggregates strict release gate output and release status packet
  output.
- A draft-ready release reports `completion: "incomplete"` and
  `blockingReason: "release_publication_approval_required"`.
- A published verified prerelease reports `completion: "complete"`.
- `--strict` exits nonzero until published prerelease verification passes.
- Docs explain how to use the audit before and after publication.
- No GitHub Release publication, deployment, DNS, email routing, tag, secret, or
  Cloudflare resource write occurs.

## Current Context

- `v0.1.0-alpha` has a draft prerelease targeting
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- `pnpm release:status:packet -- --strict ...` reports
  `phase: "draft_ready_for_publication"`.
- Publication still requires exact operator approval.

## Constraints

- Keep external compatibility brand names out of repo-controlled text.
- Do not publish the GitHub Release.
- Do not deploy from the tag or release.
- Do not mutate tags, DNS, email routing, secrets, or Cloudflare resources.

## Risks

- Treating draft-ready as complete would hide the explicit publication gate.
- Running strict completion audit before publication should fail by design.
- The audit must reuse existing status/gate scripts rather than inventing a
  separate definition of release readiness.

## Approval Required

No extra approval is required for local scripts, tests, docs, workflow
artifacts, commits, pushes, and CI. Release publication and deployment remain
separately approval-gated.

## Work Packets

- `01-script`: add the completion audit script and package command.
- `02-tests`: add focused tests for draft-ready, strict failure, published
  complete, and post-publication failure states.
- `03-docs-workflow`: update publication gate, current-state, and workflow
  artifacts.
- `04-verification`: run targeted checks, full checks, CI, and release readback.

## Integration Policy

The audit delegates readiness to `release:gate` and `release:status:packet`.
If those reports disagree, the audit must report incomplete rather than
guessing.

## Verification

- `pnpm exec vitest run test/ops/release-completion-audit.test.ts`
- `pnpm exec vitest run test/release-docs.test.ts`
- `pnpm release:completion:audit -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- strict completion audit expected failure before publication
- `pnpm release:gate -- --strict`
- full local checks before push
- GitHub Actions CI after push
- GitHub Release draft readback

## Reusable Artifacts

`scripts/honowarden-alpha-completion-audit.mjs` becomes the final local audit
before marking the alpha objective complete.
