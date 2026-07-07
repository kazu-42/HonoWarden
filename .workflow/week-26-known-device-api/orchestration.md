# Orchestration: Week 26 Known Device API

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.
- Keep the route anonymous and read-only.
- Keep mutation/trust/key APIs out of scope.
- Use tests to pin malformed header behavior before implementation.
- Delegate only disjoint docs work to Spark; do not use Spark for QA.

## Branching Rules

- If base64url decoding fails, return `400 invalid_request`.
- If email normalization fails, return `400 invalid_request`.
- If user/device lookup misses, return `false`.
- If D1 throws, return `503 database_unavailable`.

## Packet Prompts

- Repository packet: add active device existence lookup by normalized email and
  device identifier.
- Route packet: add `GET /api/devices/knowndevice` with header decoding and
  boolean response.
- Docs packet: update compatibility/current-state/security docs without
  over-claiming broader device management support.

## Completion Audit

- Known user and active device returns `true`.
- Unknown user, missing device, cross-user device, and revoked device return
  `false`.
- Malformed/missing headers return `400`.
- Broad checks and CI pass.
