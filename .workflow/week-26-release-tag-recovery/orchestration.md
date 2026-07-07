# Orchestration: Week 26 Release Tag Recovery

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.
- Do not create, move, delete, or push any tag in this workflow.
- Do not create, update, publish, or delete a GitHub Release in this workflow.

## Branching Rules

- If the recovery packet cannot prove main CI success for the recovery commit,
  do not emit approval text.
- If a GitHub Release already exists for the target tag, block recovery and
  require a separate incident decision.
- If the remote tag object differs from the expected lease, block recovery.
- If the failed tag workflow evidence does not match the failed commit, block
  recovery.
- If local verification or CI fails, fix forward on main before asking for tag
  movement approval.

## Packet Prompts

### Packet 1: CLI Contract

Do: add tests for a ready recovery packet, existing-release block, and strict
mode without main CI evidence.

Do not: create, move, delete, or push any tag.

### Packet 2: Implementation

Do: add a script that verifies tag state, CI evidence, failed tag workflow
evidence, release absence, and emits lease-guarded commands.

Do not: execute the emitted commands.

### Packet 3: Docs

Do: document the read-only packet in the tagging runbook and current-state
notes.

Do not: claim recovery has been performed before the tag is actually moved.

### Packet 4: Verification

Do: run focused tests, full tests, lint, typecheck, release gate, brand scan,
and workflow verifier.

Do not: proceed to tag movement without explicit operator approval.

## Completion Audit

- Recovery packet exists and is covered by tests.
- Docs explain the recovery packet as read-only.
- Workflow state records verification evidence.
- A separate operator approval remains required for tag movement.
