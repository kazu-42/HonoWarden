# Orchestration: Week 26 ops readiness release approval gate

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If any packet text treats local readiness inputs or draft release visibility as
  completed publication-ready status, revise before integration.
- If any packet text references unsupported write actions (tag mutation, release
  publish, Cloudflare deploy, DNS, Email Routing, email send, or secret writes),
  remove those changes immediately.
- Keep packet and verification language idempotent: no implicit state is created.

## Packet Prompts

- Packet 01: contract/code
  Add explicit publication-gate requirement language to the ops readiness packet
  artifacts and define the blocking reason semantics.

- Packet 02: tests/docs
  Add workflow-documentation packeting for local verification, command placeholders,
  and separation of approval gate vs downstream operational readiness.

- Packet 03: verification
  Prepare the evidence checklist for read-only packet status commands and keep
  completion as in progress until main-agent verification evidence is collected.

## Completion Audit

- Confirm packet 01 and packet 02 are recorded as completed after artifact writes.
- Confirm packet 03 remains pending/in progress until concrete checks are run.
- Confirm the final report records the no-mutating constraints clearly.
- Confirm workflow verification and packet readback remain planned/unchecked until
  run with main-agent evidence.
