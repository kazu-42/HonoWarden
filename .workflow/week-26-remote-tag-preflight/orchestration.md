# Orchestration: Week 26 Remote Tag Preflight

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the remote check test fails because `--check-remote` is unknown, implement
  the option rather than weakening the test.
- If `--check-remote` is omitted, keep the existing limitation that remote tag
  absence is not verified.
- If `--check-remote` is supplied and the remote tag exists, strict mode must be
  not ready.
- If remote access fails, report the check as failed rather than assuming tag
  absence.
- Do not run tag creation, push, deletion, or retag commands in this workflow.

## Packet Prompts

- Tests: add local temporary bare-repo coverage for read-only remote tag absence.
- Script: add `--check-remote` and `--remote` without changing default behavior.
- Docs: make the final release runbook use the remote-checked preflight.
- Verification: run local checks, brand scan, workflow verifier, and CI.

## Completion Audit

- Confirm no local tag was created.
- Confirm no tag was pushed.
- Confirm remote tag absence can be checked from the preflight command.
- Confirm docs no longer require a separate manual remote check before tag
  approval.
- Confirm CI passed on the final commit.
