# Spec: Week 17 Login Defenses

## Summary

Week 17 adds password-grant defenses for repeated login failures. The implementation combines account-based temporary lockout with client-address failed-attempt rate limiting while preserving safe generic token error wording.

## Inputs

- `POST /identity/connect/token`
- `grant_type=password`
- normalized username
- presented master password hash
- client network headers
- D1 `users`, `auth_attempts`, and `auth_failure_buckets` state

## Outputs

- Successful password grant:
  - existing token response shape
  - account login-defense state reset
- Wrong password for an existing active account:
  - generic `400 invalid_grant`
  - failed account state recorded
  - hashed auth-attempt bucket recorded
  - hashed failure bucket atomically advanced
- Temporarily locked account:
  - generic `400 invalid_grant`
  - no account-existence signal
- Client address over the failed-attempt limit:
  - generic `429 invalid_grant`
  - `Retry-After` header
- Unknown or disabled account:
  - generic `400 invalid_grant`
  - hashed auth-attempt bucket recorded
  - hashed failure bucket atomically advanced

## Behavior

1. Client address buckets prefer `CF-Connecting-IP`, then the first `X-Forwarded-For` address, then `unknown`.
2. Auth-attempt and failure buckets are SHA-256 based and do not store plaintext IP addresses.
3. Five failed attempts inside the account window lock an account for fifteen minutes.
4. Twenty failed attempts inside the client-address window return `429` for the configured retry interval.
5. Token endpoint response wording stays generic across unknown users, wrong passwords, locked users, and client-address throttling.
6. Failed-attempt counters are advanced through D1 conflict updates so concurrent bursts do not depend on stale read-then-write application state.
7. Successful password grants reset account failed-login state before creating the new session.

## Edge Cases

- Missing client-address headers share the `unknown` bucket.
- Disabled users are rejected through the same generic invalid-grant path.
- The auth-attempt table has no cleanup job yet; retention policy remains future work.
- Live D1 migration application is not performed in this local implementation slice.

## Acceptance Criteria

- [x] Domain tests cover lockout threshold, stale windows, active locks, hashed buckets, and client address extraction.
- [x] Migration tests cover login-defense columns, auth-attempt table, failure-bucket table, indexes, and no plaintext IP columns.
- [x] Repository tests cover failed-login record, reset, attempt insert, failed-attempt counting, and atomic failure bucket updates.
- [x] HTTP tests cover client-address rate limiting, account lockout with generic wording, and successful-login failure bucket reset.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
