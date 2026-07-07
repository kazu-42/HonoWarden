# Orchestration: Week 26 Release Gate Packet Coverage

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If a newly included workflow lacks CI evidence, add the already-passed CI run
  to that workflow state or leave it out of the gate.
- Do not include this current coverage workflow in `requiredWorkflowSlugs`.
- If release gate fails after adding a slug, inspect the state file before
  loosening gate logic.
- Do not run tag creation, tag push, release creation, release publication,
  deployment, DNS, or email routing commands.

## Packet Prompts

- Gate logic: add completed release approval and post-tag release packet
  workflows to `requiredWorkflowSlugs`.
- State evidence: record CI run IDs for those two completed workflows.
- Tests and docs: assert the new evidence paths and document the expanded gate.
- Verification: run focused and broad local checks, brand scan, workflow
  verifier, and CI.

## Completion Audit

- Confirm strict release gate remains ready.
- Confirm workflow evidence includes both packet workflow state files.
- Confirm included packet workflow states are completed, passed, and contain CI
  evidence.
- Confirm no tag, release, deploy, DNS, or email write happened.
- Confirm CI passed on the final commit.
