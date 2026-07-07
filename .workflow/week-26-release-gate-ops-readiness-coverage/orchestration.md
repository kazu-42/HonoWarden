# Orchestration: Week 26 Release Gate Ops Readiness Coverage

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

## Packet Prompts

## Completion Audit

# Week 26 Release Gate Ops Readiness Coverage Orchestration

Goal: include the completed post-alpha ops readiness packet workflow in release
gate evidence.

Sequence:

1. Delegate the small release gate script/test edit to Spark.
2. In parallel, prepare workflow docs and current-state docs.
3. Review Spark changes and verify only assigned files were edited.
4. Run focused release gate tests and strict release gate.
5. Run broad local checks and read-only release status packets.
6. Commit, push, and read back CI.

Branching rules:

- If Spark edits outside its assigned files, inspect and keep only relevant
  changes.
- If strict release gate fails because the ops readiness workflow state lacks CI
  evidence, stop and inspect `.workflow/week-26-post-alpha-ops-readiness-packet`.
- If the gate tries to require this coverage workflow itself, remove that
  self-reference.

Packets:

- `01-spark-gate-edit`
- `02-docs-workflow`
- `03-verification`
