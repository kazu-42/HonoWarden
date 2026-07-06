# Spec: Week 08 Empty Vault Sync

## Summary

Week 08 adds authenticated empty vault sync. A client with a valid access token can call `GET /api/sync` and receive a personal profile with empty vault collections.

## Inputs

- `GET /api/sync`
- `Authorization: Bearer <access token>`
- `HONOWARDEN_TOKEN_SECRET`

## Outputs

- Valid access token:
  - HTTP `200`
  - sync response with profile, empty folders, empty collections, empty ciphers, empty domains, empty policies, and empty sends
- Missing, invalid, expired, disabled-user, or missing-secret access token:
  - stable JSON error response

## Behavior

1. The access token signature is verified with `HONOWARDEN_TOKEN_SECRET`.
2. Expired access tokens are rejected.
3. The user ID from token claims is looked up in D1.
4. Disabled users cannot sync.
5. Empty sync response contains no plaintext vault data.

## Edge Cases

- Missing authorization header returns `401`.
- Malformed bearer header returns `401`.
- Missing token secret returns `503`.
- Unknown user returns `401`.

## Acceptance Criteria

- [x] Domain tests cover access token verification, invalid signature, and expiration.
- [x] Repository tests cover user lookup by ID.
- [x] HTTP tests cover missing authorization, valid empty sync, invalid token, and missing token secret.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
