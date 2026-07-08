# Orchestration: Week 26 release gate ops approval coverage

Goal:
Require `.workflow/week-26-ops-readiness-release-approval-gate/state.json` in the
release gate evidence path while keeping this workflow coverage slice non-self
referential.

## Execution Rules

- Keep the original objective intact.
- Keep immediate blocking work local.
- Keep delegated artifact edits inside this workflow directory; companion
  code/test/docs integration is handled by the main agent.
- Keep packet updates bounded and disjoint.
- Integrate packet results before finalization.

## Branching Rules

- If the required workflow is missing CI evidence, keep the gate requirement pending
  and do not add it to `requiredWorkflowSlugs` in code.
- If this coverage workflow is added to `requiredWorkflowSlugs`, remove it from the
  list to avoid deadlock.
- If external actions are introduced in logs or artifacts, stop and remove them.

## Packet Prompts

- `01-gate-implementation`: define the required workflow slug and evidence path that
  release gate should include.
- `02-docs-workflow`: finalize this workflow package (plan/orchestration/results
  - packets + state/final report).
- `03-verification`: record verification status and CI evidence for this coverage
  workflow once the main run is available.

## Completion Audit

- `requiredWorkflowSlugs` includes `week-26-ops-readiness-release-approval-gate`.
- `.workflow/week-26-ops-readiness-release-approval-gate/state.json` is documented as required evidence.
- This coverage workflow is excluded from `requiredWorkflowSlugs`.
- Packets 01, 02, and local verification in packet 03 are marked completed in
  `state.json`.
- CI evidence for this coverage workflow is recorded from the first passing main
  run after the PR landed.
- No release publication, tag mutation, Cloudflare deploy/DNS/Email Routing writes,
  email send, or secret write is listed as completed.
