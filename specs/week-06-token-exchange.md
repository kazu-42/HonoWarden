# Spec: Week 06 Token Exchange

## Summary

Week 06 introduces the first password grant token exchange. It authenticates against the stored master password hash created during bootstrap, records the device, stores only a hashed refresh token, and returns the client-facing token response shape.

## Inputs

- `POST /identity/connect/token`
- `application/x-www-form-urlencoded` body:
  - `grant_type=password`
  - `username`
  - `password`
  - optional `scope`
- Device headers:
  - `Device-Identifier`
  - optional `Device-Name`
  - optional `Device-Type`
- `HONOWARDEN_TOKEN_SECRET`

## Outputs

- Valid password grant:
  - HTTP `200`
  - token response with access token, refresh token, token type, expiry, key material, and KDF fields
- Invalid grant, missing device, unsupported grant, missing secret, or unavailable DB:
  - stable JSON error response

## Behavior

1. Only the password grant is supported in this increment.
2. Email usernames are normalized before lookup.
3. The submitted password value is compared with the stored master password hash using constant-time comparison.
4. Disabled users cannot receive tokens.
5. Access tokens are HMAC signed and short-lived.
6. Refresh token plaintext is returned once and only its secret-bound SHA-256 hash is stored in D1.
7. Device rows are upserted before refresh token rows.

## Edge Cases

- Missing `HONOWARDEN_TOKEN_SECRET` returns `503`.
- Missing device identifier returns `400`.
- Unknown user and wrong password return the same invalid grant error shape.
- Refresh token insert failure returns `503` without leaking token plaintext or SQL details.

## Acceptance Criteria

- [x] Domain tests cover form parsing, invalid grants, token signing, and refresh token hashing.
- [x] Repository tests cover user lookup and hashed refresh token insertion.
- [x] HTTP tests cover successful password grant, invalid grant, missing device, and missing token secret.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
