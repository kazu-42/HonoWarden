# Orchestration: Week 12 Multi Item Round Trip

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If secure-note type support requires schema changes, stop and reassess before migration work.
- If unknown fields are dropped in response merging, fix DTO construction before adding more tests.
- If 50 item sync becomes slow or memory-heavy in tests, measure before adding pagination.
- If local full checks fail, do not push.

## Packet Prompts

- `01-cipher-validation`: broaden cipher type validation to include secure notes.
- `02-round-trip-tests`: add HTTP tests for unknown encrypted field preservation and 50 item sync.
- `03-docs-fixtures`: update docs/spec/workflow status.
- `04-verification`: run full local verification, push, and watch CI.

## Completion Audit

- Packet 01: complete.
- Packet 02: complete.
- Packet 03: complete.
- Packet 04: complete, CI passed for implementation commit `a58b29e`.
