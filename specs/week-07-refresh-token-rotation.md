# Spec: Week 07 Refresh Token Rotation

## Summary

Week 07 adds refresh token grant support. Refresh tokens rotate on every successful use. Reusing an already-rotated or revoked refresh token invalidates the device session.

## Inputs

- `POST /identity/connect/token`
- `application/x-www-form-urlencoded` body:
  - `grant_type=refresh_token`
  - `refresh_token`
- `HONOWARDEN_TOKEN_SECRET`

## Outputs

- Valid refresh grant:
  - HTTP `200`
  - new access token
  - new refresh token
  - KDF and encrypted key fields matching the password grant response
- Unknown, expired, revoked, reused, disabled-user, or revoked-device refresh token:
  - HTTP `400`
  - `invalid_grant`

## Behavior

1. The presented refresh token is hashed with `HONOWARDEN_TOKEN_SECRET` before lookup.
2. Refresh token plaintext is never stored.
3. A valid refresh grant revokes the current refresh token and inserts a new one linked by `rotated_from_token_id`.
4. If a revoked token is presented again, every active refresh token for the same user and device is revoked.
5. Disabled users and revoked devices cannot refresh.
6. Missing token secret fails closed with the same `503` path used by password grant.

## Edge Cases

- Missing `refresh_token` returns `invalid_request`.
- Expired refresh tokens return `invalid_grant`.
- Concurrent reuse is treated as reuse detection if the old token can no longer be conditionally revoked.
- Unknown refresh tokens return `invalid_grant` without session changes.

## Acceptance Criteria

- [x] Domain tests cover refresh grant parsing and invalid request shape.
- [x] Repository tests cover refresh lookup, rotation, and session invalidation.
- [x] HTTP tests cover successful refresh, reused token invalidation, unknown token, and missing token secret.
- [x] Compatibility fixture includes a refresh grant success shape.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
