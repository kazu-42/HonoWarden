# Orchestration: Week 26 main CI brand scan

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If Spark introduces contiguous forbidden provider-brand literals, rewrite the
  pattern to split fragments before running the scan.
- If focused workflow tests already exist, extend them instead of creating
  overlapping tests.
- If release status remains `draft_ready_for_publication`, keep release
  publication blocked on explicit approval and continue local-only work.

## Packet Prompts

### Packet 01: Spark Implementation

Objective: add repository brand scan to main CI and a focused workflow test.

Ownership:

- `.github/workflows/ci.yml`
- `test/ops/ci-workflow.test.ts`

Do:

- Mirror the release-tag workflow split `BLOCKED_PATTERN` scan.
- Assert the CI workflow includes the core steps and `BLOCKED_PATTERN`.

Do not:

- Run broad QA.
- Edit docs, release scripts, package metadata, or source application code.

### Packet 02: Main Integration And Evidence

Objective: review, verify, document, commit, push, and record CI evidence.

Ownership:

- `docs/current-state.md`
- `.workflow/week-26-main-ci-brand-scan/**`

Do:

- Update docs with the main CI brand-scan gate.
- Run local checks and read-only release audits.
- Push and verify GitHub Actions.

Do not:

- Publish the release or mutate external infrastructure.

## Completion Audit

- Main CI includes repository brand scan.
- Focused workflow test and full local checks pass.
- Pushed commit has successful GitHub Actions CI.
