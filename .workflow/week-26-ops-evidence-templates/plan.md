# Week 26 Ops Evidence Templates

## Goal

Add conservative post-alpha operations evidence placeholders for Worker live
smoke, website live route, Email Routing, and rollback evidence.

## Success Criteria

- Evidence files exist under `docs/release/`.
- Each evidence file starts as `Status: not_performed`.
- `pnpm ops:readiness:packet` remains `not_ready`.
- Release docs link the evidence files.
- Tests prove placeholders do not satisfy live evidence requirements.
- No release publication, Worker deploy, DNS mutation, Email Routing mutation,
  email send, or secret write is performed.

## Current Context

The ops readiness packet now checks for:

- `docs/release/worker-live-smoke-evidence.md`
- `docs/release/website-live-evidence.md`
- `docs/release/email-routing-evidence.md`
- `docs/release/ops-rollback-evidence.md`

Absent files and non-`passed` files both block readiness. Adding explicit
`not_performed` files gives operators exact evidence fields without overstating
operational proof.

## Constraints

- Evidence placeholders must not claim work that has not run.
- Keep post-alpha ops readiness separate from GitHub Release publication.
- Do not touch Cloudflare, DNS, Email Routing, secrets, or production data.

## Risks

- Accidentally writing `Status: passed` would make the packet treat unverified
  operations as complete.
- Recording private forwarding destinations, message bodies, tokens, or real
  vault data would leak sensitive information.
- Treating local preflight as live evidence would blur the ops gate.

## Approval Required

No approval is required for local docs, tests, and workflow artifacts. Approval
is required before release publication, deploy, DNS, Email Routing, email sends,
or secret writes.

## Work Packets

- `01-evidence-docs`: add the four conservative evidence files.
- `02-docs-tests`: update docs index/current-state and tests.
- `03-verification`: run focused tests, packet readback, local gates, push, and
  CI readback.

## Integration Policy

Accept only docs/test/workflow changes that preserve `Status: not_performed` and
keep ops readiness blocked. Reject any placeholder that claims live evidence.

## Verification

- `pnpm exec vitest run test/ops/ops-readiness-packet.test.ts test/release-docs.test.ts`
- `pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm brand:scan`
- `pnpm test`
- `pnpm compat:test`
- `pnpm release:gate -- --strict`

## Reusable Artifacts

The evidence files become the operator checklist for post-alpha deploy, website,
email, and rollback approval gates.
