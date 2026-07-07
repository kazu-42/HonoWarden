# Packet 01: Spark Gate Implementation

Objective: require the completed shared-scan workflow in release gate evidence.

Files:

- `scripts/honowarden-release-gate.mjs`
- `test/ops/release-gate.test.ts`

Do:

- Add `week-26-release-evidence-shared-brand-scan` to
  `requiredWorkflowSlugs`.
- Add a release gate test assertion for
  `.workflow/week-26-release-evidence-shared-brand-scan/state.json`.

Do not:

- Add `.workflow/week-26-release-gate-shared-scan-coverage/state.json`.
- Touch docs, workflow artifacts, package metadata, or release publication
  scripts.
- Run broad QA.
