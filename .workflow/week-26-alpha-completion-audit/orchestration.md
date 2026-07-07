# Orchestration: Week 26 Alpha Completion Audit

Goal:
Add a read-only completion audit that prevents treating draft-ready alpha state
as complete.

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the status packet reports `draft_ready_for_publication`, completion audit
  must be incomplete and strict mode must fail.
- If the status packet reports `published_verified` and release gate is ready,
  completion audit may report complete.
- If release gate is not ready, completion audit must report incomplete even if
  release status looks published.
- If publication state changes unexpectedly, stop and read back GitHub Release
  state before continuing.

## Packet Prompts

- `01-script`: implement the audit script and package command.
- `02-tests`: add fake git/gh tests covering key phases.
- `03-docs-workflow`: document usage and update workflow state.
- `04-verification`: run checks, push, watch CI, and read back release state.

## Completion Audit

- Current real release state should remain draft and audit should be
  incomplete.
- Published verified fake test must prove complete behavior.
- No external write command should be run.
