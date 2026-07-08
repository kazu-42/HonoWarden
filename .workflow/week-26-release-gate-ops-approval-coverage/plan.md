# Week 26 release gate ops approval coverage

## Goal

Require the completed operations-readiness release approval gate workflow as release-gate
evidence after CI evidence is recorded, while keeping this coverage workflow
non-self-referential.

## Success Criteria

- `requiredWorkflowSlugs` includes `week-26-ops-readiness-release-approval-gate`.
- Release gate tests assert `.workflow/week-26-ops-readiness-release-approval-gate/state.json`.
- This coverage workflow is not added to `requiredWorkflowSlugs`.
- This workflow artifact performs no external writes; companion code/test/docs
  changes are integrated by the main agent.
- CI evidence for this coverage workflow itself remains pending until explicitly
  recorded by the main agent.

## Current Context

The target workflow file for the requirement is
`.workflow/week-26-ops-readiness-release-approval-gate/state.json`.
This slice records the release-gate coverage intent and packet status after the
target workflow has completed, while deferring CI evidence capture for this new
coverage workflow.

## Constraints

- Do not include `.workflow/week-26-release-gate-ops-approval-coverage` in
  `requiredWorkflowSlugs`.
- No GitHub release publication.
- No tag create/update/delete/move.
- No Cloudflare deploy/DNS/Email Routing writes.
- No email sends.
- No secret writes.

## Risks

- Self-reference would create a gate deadlock before this coverage workflow has its
  own CI evidence.
- Requiring a workflow without CI evidence could block release readiness unexpectedly.
- Out-of-scope operations (publication, deploy, routing, secrets) could be
  mistakenly interpreted as completed if not explicitly forbidden.

## Approval Required

No approval required for this workflow artifact update.
The listed operational writes and publication actions remain approval-gated elsewhere.

## Work Packets

- `01-gate-implementation`: define required slugs/evidence wiring targets.
- `02-docs-workflow`: complete the workflow artifact package for this coverage
  slice.
- `03-verification`: record current verification posture; CI evidence for this
  coverage workflow is pending.

## Integration Policy

Keep this workflow artifact non-self-referential. Companion code/test/docs updates
may land in the same PR, but this coverage workflow must not be listed in
`requiredWorkflowSlugs`.

## Verification

- `pnpm exec vitest run test/ops/release-gate.test.ts` (to be executed with code
  changes).
- `pnpm release:gate -- --strict` (with `week-26-ops-readiness-release-approval-gate`
  included).
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-release-gate-ops-approval-coverage`
- CI evidence readback for this coverage workflow state run (pending in this slice).

## Reusable Artifacts

Use the standard pattern: gate update first, document in this workflow folder, then
add CI evidence in `state.json` when the main evidence run is available.
