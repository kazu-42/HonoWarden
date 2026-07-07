# Orchestration: Week 26 Device List API

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If exact mutation semantics are ambiguous, leave update routes out of scope.
- If response-field naming conflicts with local style, keep route-specific
  compatibility mapping at the API boundary.
- If compatibility docs mention unsupported metadata updates, narrow the wording
  to list/get now implemented and mutation still incomplete.

## Packet Prompts

- Repository packet: add active-device read methods under
  `src/repositories/auth-repository.ts`.
- Route packet: add `GET /api/devices` and
  `GET /api/devices/identifier/:identifier`.
- Docs packet: update state and compatibility docs without over-claiming.

## Completion Audit

- Owner-scoped tests cover list and identifier lookup.
- Route tests cover success, auth failure, and missing identifier behavior.
- Compatibility docs no longer say device list is missing.
