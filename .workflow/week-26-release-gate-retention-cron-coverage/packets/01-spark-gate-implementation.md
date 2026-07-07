# Packet 01: Spark Gate Implementation

Objective: require the completed retention cleanup Cron Trigger workflow in
release gate evidence.

Files:

- `scripts/honowarden-release-gate.mjs`
- `test/ops/release-gate.test.ts`

Do:

- Add `week-26-retention-cleanup-cron-trigger` to `requiredWorkflowSlugs`.
- Add a release gate test assertion for
  `.workflow/week-26-retention-cleanup-cron-trigger/state.json`.

Do not:

- Add `.workflow/week-26-release-gate-retention-cron-coverage/state.json`.
- Touch docs, workflow artifacts, package metadata, or release publication
  scripts.
- Run broad QA.
