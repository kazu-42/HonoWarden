# Orchestration: Week 26 Ops Evidence Templates

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

## Packet Prompts

## Completion Audit

# Week 26 Ops Evidence Templates Orchestration

Goal: add conservative evidence placeholders for the operations readiness packet.

Sequence:

1. Add `Status: not_performed` evidence files for Worker live smoke, website
   live route, Email Routing, and rollback.
2. Link them from release and website/email docs.
3. Add tests that ensure placeholders remain conservative.
4. Run focused tests and the ops readiness packet; confirm it remains blocked.
5. Run broad local checks, push, and read back CI.

Branching rules:

- If any placeholder says `Status: passed`, stop and correct it before testing.
- If the ops readiness packet reports `ready`, stop and inspect evidence status
  detection.
- If any external write would be needed, stop and require explicit approval.
