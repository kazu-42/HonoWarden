# Week 26 Publication Gate Runbook

## Goal

Add a human-readable publication gate runbook for `v0.1.0-alpha` and require
it in the alpha release documentation gate.

## Success Criteria

- `docs/release/publication-gate.md` records the current draft target, status
  packet command, exact approval text, repo-scoped publish command, and
  post-publication verification commands.
- `docs/release/index.md` links the publication gate.
- `scripts/honowarden-release-gate.mjs` treats the publication gate as a
  required release document.
- `test/release-docs.test.ts` asserts the approval boundary and command
  strings.
- No GitHub Release publication, deployment, DNS, email routing, tag, secret, or
  Cloudflare resource write occurs.

## Current Context

- `v0.1.0-alpha` has a draft prerelease targeting
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- `Release Tag Verification` run `28863312935` passed.
- `pnpm release:status:packet -- --strict ...` reports
  `phase: "draft_ready_for_publication"`.
- Publication still requires exact operator approval.

## Constraints

- Keep external compatibility brand names out of repo-controlled text.
- Do not publish the GitHub Release in this workflow.
- Do not deploy from the tag or release.
- Do not mutate production services, DNS, email routing, secrets, or tags.

## Risks

- A static runbook can drift from the machine-readable status packet, so tests
  should lock the key command strings and approval text.
- Publishing and deployment have different blast radii; the runbook must keep
  deployment out of scope.

## Approval Required

No extra approval is required for local docs, tests, workflow artifacts, git
push, and CI. Publishing the GitHub Release, deploying, changing DNS/email,
mutating secrets, or changing tags remains separately approval-gated.

## Work Packets

- `01-runbook`: add the publication gate document and index link.
- `02-gate-tests`: require the doc in release gate and release-docs tests.
- `03-verification`: run targeted and full checks, push, watch CI, and read back
  release draft state.

## Integration Policy

Keep the runbook consistent with `release:status:packet` output and do not make
the document imply deployment readiness.

## Verification

- `pnpm exec vitest run test/release-docs.test.ts test/ops/release-gate.test.ts`
- `pnpm release:gate -- --strict`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- workflow verifier
- full local checks before push
- GitHub Actions CI after push
- GitHub Release draft readback

## Reusable Artifacts

`docs/release/publication-gate.md` becomes the operator-facing publication
gate for this alpha target.
