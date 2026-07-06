# Integration Checklist: week-06-token-exchange

## 01 Token Domain

# Packet 01 Result: Token Domain

Accepted:

- Added password grant form parsing with normalized username.
- Added constant-time presented hash comparison.
- Added HMAC-signed access token helper.
- Added random refresh token generation.
- Added secret-bound refresh token hashing.
- Added token error response mapping.
  Verification:
- `pnpm test test/domain/tokens.test.ts` passed with 6 tests.
  Remaining risks:
- Access token verification and auth middleware are not part of this slice.

## 02 Auth Repository

# Packet 02 Result: Auth Repository

Accepted:

- Added auth user lookup by normalized email.
- Added device upsert and refresh token insert.
- Repository interface accepts a refresh token hash, not plaintext.
- Device ID is derived from user ID and client device identifier.
  Verification:
- `pnpm test test/repositories/auth-repository.test.ts` passed with 2 tests.
  Remaining risks:
- Refresh token rotation and reuse detection are deferred to the next slice.

## 03 Route Integration

# Packet 03 Result: Route Integration

Accepted:

- Added `POST /identity/connect/token` for password grant.
- Missing token secret fails closed with `503`.
- Missing device identifier fails with stable invalid request response.
- Unknown user and wrong password share the same invalid grant response.
- Successful grant returns fixture-compatible token response fields.
  Verification:
- `pnpm test test/app.test.ts` passed with 19 tests.
- `pnpm check` passed after narrowing token error result types.
  Remaining risks:
- Local dev server does not have `HONOWARDEN_TOKEN_SECRET`, so success path is currently covered by route tests rather than live local smoke.

## Integration Decisions

Accepted:

Rejected:

Conflicts:

Remaining risks:

Verification still needed:
