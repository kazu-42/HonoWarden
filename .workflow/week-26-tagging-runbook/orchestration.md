# Orchestration: Week 26 Tagging Runbook

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the release docs test fails because the runbook is absent, add the runbook
  rather than removing the test requirement.
- If release gate fails after adding the runbook requirement, fix the required
  doc list or document substance before continuing.
- If tag commands are needed for documentation, include them as operator
  examples only; do not execute them.
- If remote tag deletion or retagging is discussed, keep it incident-handling
  documentation and require explicit approval.
- If CI fails after push, inspect the failed job before starting another slice.

## Packet Prompts

- Tests and gate: add `tagging-runbook.md` to required release docs and lock
  approval-gated tag wording in tests.
- Runbook: write the operator procedure with preconditions, approval gate,
  commands, verification, failure handling, and post-tag follow-up.
- Docs integration: link the runbook from release index, preflight docs,
  release notes, and current state.
- Verification: run local checks, brand scan, workflow verifier, and CI.

## Completion Audit

- Confirm no local tag was created.
- Confirm no tag was pushed.
- Confirm the release gate remains ready.
- Confirm the runbook remains approval-gated.
- Confirm CI passed on the final commit.
