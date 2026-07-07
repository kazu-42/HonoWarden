# Week 26 Release Gate Ops Readiness Coverage

## Goal

Require the completed post-alpha operations readiness packet workflow in the
alpha release gate so future readiness checks cannot drop the deploy/email ops
packet accidentally.

## Success Criteria

- `week-26-post-alpha-ops-readiness-packet` is included in release gate required
  workflow evidence.
- Release gate tests assert
  `.workflow/week-26-post-alpha-ops-readiness-packet/state.json`.
- The completed ops readiness workflow state contains passed CI evidence.
- Strict release gate remains ready.
- No release publication, deploy, DNS, email routing, or secret write is
  performed.

## Current Context

`fed04bf` is on `main` and `origin/main`, and CI run `28889563869` passed.
The ops readiness packet workflow itself recorded implementation CI run
`28889474503`, which is enough evidence to include that completed workflow in
the release gate. The current GitHub Release remains a draft prerelease and
still requires explicit publication approval.

## Constraints

- Spark may perform only the simple release gate script/test edit.
- Main agent owns workflow docs, current-state docs, integration, and QA.
- Keep release gate coverage non-self-referential; do not require this new
  coverage workflow in the same gate change.
- Do not mutate tags, GitHub Releases, Cloudflare, DNS, Email Routing, Linear,
  secrets, or production data.

## Risks

- Adding this coverage workflow to its own gate would create an impossible
  self-reference before its CI evidence exists.
- Adding a workflow state without CI evidence would weaken release gate
  semantics.
- Treating the ops readiness packet as release publication approval would
  violate the release gate model.

## Approval Required

No approval is required for local release gate script/test/docs/workflow changes
and git push. Approval is required before release publication, deploy, DNS,
Email Routing, email sends, or secret writes.

## Work Packets

- `01-spark-gate-edit`: Spark updates release gate required slugs and focused
  test assertion.
- `02-docs-workflow`: main updates current-state and workflow artifact.
- `03-verification`: main runs focused tests, strict release gate, broad local
  checks, workflow verifier, CI readback, and release status packets.

## Integration Policy

Accept Spark changes only if they are limited to the assigned release gate
files and preserve strict gate readiness. Reject self-referential gate coverage
for this workflow.

## Verification

- `pnpm exec vitest run test/ops/release-gate.test.ts`
- `pnpm release:gate -- --strict`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-release-gate-ops-readiness-coverage`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm brand:scan`
- `pnpm test`
- `pnpm compat:test`
- read-only release status and ops readiness packets

## Reusable Artifacts

This follows the release gate coverage pattern used for completed Week 26
packet workflows: first land the workflow, then add a separate gate coverage
commit after CI evidence exists.
