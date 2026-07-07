# Orchestration: Week 26 release gate device metadata coverage

## Execution Rules

- Keep this slice limited to release gate evidence coverage.
- Do not include this current coverage workflow in `requiredWorkflowSlugs`.
- If strict release gate fails, inspect workflow state evidence and fix forward.
- Keep release publication, deployment, tag mutation, DNS/email, Cloudflare,
  Linear, secrets, and production data approval-gated.

## Branching Rules

- If Spark touches files outside its scope, review carefully and revert only
  Spark-owned mistakes.
- If `week-26-device-metadata-update-api` state is not completed with CI
  evidence, stop and fix that evidence instead of weakening the gate.

## Packet Prompts

### Packet 01: Spark Gate Implementation

Objective: require the completed device metadata update API workflow in release
gate evidence.

Ownership:

- `scripts/honowarden-release-gate.mjs`
- `test/ops/release-gate.test.ts`

Do:

- Add `week-26-device-metadata-update-api` to `requiredWorkflowSlugs`.
- Add a focused test assertion that `workflow_evidence` includes
  `.workflow/week-26-device-metadata-update-api/state.json`.

Do not:

- Add this current coverage workflow to the release gate.
- Change release gate semantics beyond required workflow evidence.
- Publish releases, deploy, move tags, mutate external systems, or touch
  secrets.

### Packet 02: Main Docs And Verification

Objective: document, verify, commit, push, and record CI evidence.

Ownership:

- `docs/current-state.md`
- `.workflow/week-26-release-gate-device-metadata-coverage/**`

Do:

- Document the new release gate evidence coverage.
- Review Spark changes.
- Run local checks and read-only release status checks.
- Commit, push, and record CI evidence.

Do not:

- Perform external release publication, deployment, or Cloudflare mutation.

## Completion Audit

- Strict release gate remains ready.
- CI passes after push.
