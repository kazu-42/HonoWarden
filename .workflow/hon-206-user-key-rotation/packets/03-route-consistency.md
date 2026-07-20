# Packet 03: default-off route and generation consistency

## Objective

Wire the strict parser and atomic repository through the authenticated pinned
route while preserving fail-closed status, session, and projection behavior.

## Acceptance

- `HONOWARDEN_USER_KEY_ROTATION_ENABLED` is exact-true and false in every
  tracked environment.
- Disabled POST/HEAD bypasses global quota persistence and returns D1-free 501.
- Feature gate, authentication, bounded parser/account-key validation,
  notification binding preflight, credential-proof defense, snapshot
  validation, and D1 mutation occur in that order. Malformed input and a known
  missing binding do not consume credential-failure state.
- Invalid request/proof, unsupported state, stale generation, query budget,
  conflict, infrastructure failure, and committed-success paths have explicit
  non-secret status/error behavior.
- D1 success is acknowledged before best-effort Durable Object cleanup.
- Old access/refresh/password generations fail; new login/profile/token/sync/
  backup project one complete consistent generation. Restart evidence remains
  Packet 04's real-D1 lifecycle gate.

## Boundary

No deployment, remote flag activation, real account, V2 data, or official-client
compatibility promotion belongs to this packet.
