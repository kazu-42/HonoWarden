# Final Report: Week 26 Linear request plan

## Outcome

## Accepted Results

## Rejected Results

## Conflicts Resolved

## Verification Evidence

## Remaining Risks

## Reusable Follow-up

# Week 26 Linear request plan final report

## Status

Implemented and locally verified.

## Accepted

- Spark implemented the bounded script/test slice in the assigned files.
- Codex integrated package wiring, docs, and workflow artifacts.
- Codex tightened the implementation so `mutationSteps` accept only executable
  mutation actions: `create` and `create_or_update`.
- Codex added fail-closed malformed-step handling for mutation steps missing
  required execution shape.
- Codex fixed local review findings so request steps include ID-resolution
  requirements for seeded project labels, issue blockers, view label filters,
  view status filters, and project-filtered views.
- `pnpm linear:request-plan` reads a ready mutation packet and emits a
  local-only executor contract for a future guarded writer.
- The request plan separates request steps, existing-object confirmations, and
  manual confirmations.
- The command does not read credentials, call network APIs, resolve Linear IDs,
  or execute writes.
- Request entries use local intent names instead of unverified live GraphQL
  mutation names.

## Verification

Passed:

- `pnpm exec vitest run test/ops/linear-request-plan.test.ts`
- `pnpm exec vitest run test/ops/linear-mutation-packet.test.ts test/ops/linear-request-plan.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- `pnpm exec eslint scripts/honowarden-linear-request-plan.mjs test/ops/linear-request-plan.test.ts`
- blocked apply-plan -> mutation-packet -> request-plan smoke
- ready fixture apply-plan -> mutation-packet -> request-plan smoke
- seed-derived request-plan dependency smoke:
  - project label dependencies require `labelIds`
  - issue `blockedBy` dependencies require `blockedByIssueIds`
  - issue `stateType` requires `stateId`
  - view label filters require `labelIds`
  - view status filters require `stateIds`
  - view project filters require `projectId`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-linear-request-plan`
- `git diff --check`
- target-file secret pattern scan
- `codex review --uncommitted`

Local review follow-up:

- Review flagged missing ID requirements for issue blockers and label-filtered
  views; both were fixed and covered by tests/smoke output.
- Review flagged missing project label ID requirements; fixed and covered by
  tests/smoke output.
- Review flagged missing state ID requirements for status-filtered views; fixed
  and covered by tests/smoke output.
- Review flagged missing project ID requirements for project-filtered views;
  fixed and covered by tests/smoke output.
- The final review rerun reported no correctness issues.

## Remaining Risks

- `LINEAR_API_KEY` is still missing locally, so strict live preflight cannot yet
  produce a ready report.
- The request plan intentionally does not perform live writes.
- Future execution still needs API contract confirmation, Linear ID lookup,
  idempotent mutation logic, live readback, and write-scope evidence.
