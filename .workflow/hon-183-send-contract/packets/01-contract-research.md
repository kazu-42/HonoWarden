# Packet 01: Contract Research

## Objective

Map the reproducibly pinned official-client and official-server Send behavior
needed for an interoperable HonoWarden design.

## Acceptance

- Record owner and anonymous route inventory.
- Record encrypted key/payload ownership and client-side password derivation.
- Record short-lived access-token, credential, access-count, and file lifecycle
  behavior.
- Confirm HonoWarden currently rejects every route after any enabled global
  ingress quota check but before route-specific auth/Send storage, and keeps
  `send-enabled` false.

## Guardrails

- Read-only public source research only.
- Track commit pins and source paths, not copied implementation or brand copy.
