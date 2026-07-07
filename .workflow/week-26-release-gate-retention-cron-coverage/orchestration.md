# Orchestration: Week 26 Release Gate Retention Cron Coverage

## Execution Rules

- Keep this slice limited to release gate evidence coverage.
- Do not include this current coverage workflow in `requiredWorkflowSlugs`.
- If strict release gate fails, inspect workflow state evidence and fix forward.
- Keep release publication, deployment, tag mutation, DNS, email, Cloudflare,
  and secret writes approval-gated.

## Work Packets

### Packet 01: Spark Gate Implementation

Objective: require the completed retention cleanup Cron Trigger workflow in
release gate evidence.

Ownership:

- `scripts/honowarden-release-gate.mjs`
- `test/ops/release-gate.test.ts`

Do:

- Add `week-26-retention-cleanup-cron-trigger` to `requiredWorkflowSlugs`.
- Add a focused test assertion that `workflow_evidence` includes
  `.workflow/week-26-retention-cleanup-cron-trigger/state.json`.

Do not:

- Add this current coverage workflow to the release gate.
- Change release gate semantics beyond required workflow evidence.
- Publish releases, deploy, move tags, mutate external systems, or touch
  secrets.

### Packet 02: Main Docs And Verification

Objective: document, verify, commit, push, and record CI evidence.

Ownership:

- `docs/current-state.md`
- `.workflow/week-26-release-gate-retention-cron-coverage/**`

Do:

- Document the new release gate evidence coverage.
- Run focused and broad local checks.
- Push and record GitHub Actions CI readback.

Do not:

- Perform external release publication, deployment, or Cloudflare mutation.

## Completion Audit

- Strict release gate remains ready.
- CI passes after push.
