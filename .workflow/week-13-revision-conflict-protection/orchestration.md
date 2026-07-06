# Orchestration: Week 13 Revision Conflict Protection

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If repository tests reveal that D1 cannot distinguish stale and missing rows cheaply, prefer one follow-up owner-scoped `SELECT` after a failed guarded update.
- If request payloads lack `revisionDate`, fail fast with `400 invalid_request` rather than allowing an unguarded update.
- If stale conflicts surface in both repository and route tests, implement the shared response code once and keep route-specific payload parsing separate.

## Packet Prompts

- `01-repository-guards`
  - Objective: make folder and cipher update writes require an expected current revision.
  - Files: `src/repositories/folder-repository.ts`, `src/repositories/cipher-repository.ts`, repository tests.
  - Verification: targeted repository tests fail before implementation and pass after implementation.
- `02-route-conflicts`
  - Objective: require update request `revisionDate` and return `409 revision_conflict` for stale updates.
  - Files: `src/app.ts`, `test/app.test.ts`, `test/support/fake-d1.ts`.
  - Verification: HTTP tests cover success, missing revision, and stale revision for folders and ciphers.
- `03-docs-workflow`
  - Objective: record the Week13 contract and final state.
  - Files: `specs/week-13-revision-conflict-protection.md`, `docs/current-state.md`, workflow files.
  - Verification: workflow artifact completeness check.
- `04-verification`
  - Objective: prove the integrated repo is ready to push.
  - Files: no source ownership.
  - Verification: full local gates, brand scan, push, and CI result.

## Completion Audit

- Confirm repository update SQL includes `revision_date = ?`.
- Confirm stale writes return `409`, missing active records return `404`, and malformed missing expected revisions return `400`.
- Confirm no direct upstream-provider brand string is present in tracked source or docs.
- Confirm CI result is recorded in `state.json` and `final-report.md`.
