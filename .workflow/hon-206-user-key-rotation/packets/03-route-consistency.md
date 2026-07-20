# Packet 03: default-off route and generation consistency

## Objective

Wire the strict parser and atomic repository through the authenticated pinned
route while preserving fail-closed status, session, and projection behavior.

## Acceptance

- `HONOWARDEN_USER_KEY_ROTATION_ENABLED` is exact-true and false in every
  tracked environment.
- Disabled POST/HEAD bypasses global quota persistence and returns D1-free 501.
- Auth, credential-proof defense, notification binding preflight, parser,
  snapshot validation, and D1 mutation occur in that order.
- Invalid request/proof, unsupported state, stale generation, query budget,
  conflict, infrastructure failure, and committed-success paths have explicit
  non-secret status/error behavior.
- D1 success is acknowledged before best-effort Durable Object cleanup.
- Old access/refresh generations fail; new login/profile/token/sync/backup
  project one complete consistent generation after restart.

## Boundary

No deployment, remote flag activation, real account, V2 data, or official-client
compatibility promotion belongs to this packet.
