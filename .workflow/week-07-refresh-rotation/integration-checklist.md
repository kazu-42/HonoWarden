# Integration Checklist: week-07-refresh-rotation

## 01 Refresh Domain

# Packet 01 Result: Refresh Domain

Accepted:

- Added `parseRefreshTokenGrantForm`.
- Missing refresh token returns stable `invalid_request`.
- Existing token error response shape is reused.
  Verification:
- `pnpm test test/domain/tokens.test.ts` passed with 8 tests.
  Remaining risks:
- Refresh token grant verification depends on repository and route packets.

## 02 Refresh Repository

# Packet 02 Result: Refresh Repository

Accepted:

- Added refresh token session lookup by hash with user and device context.
- Added conditional old-token revoke.
- Added child refresh token hash insertion with `rotated_from_token_id`.
- Added device-session invalidation on reuse detection.
- Tests verify plaintext refresh tokens are not stored.
  Verification:
- `pnpm test test/repositories/auth-repository.test.ts` passed with 6 tests.
  Remaining risks:
- Alerting/audit log for token reuse is not implemented yet.

## 03 Route Fixture Docs

# Packet 03 Result: Route, Fixture, Docs

Accepted:

- Wired refresh grant into `POST /identity/connect/token`.
- Successful refresh returns the shared token response shape.
- Revoked token reuse invalidates the device session and returns `invalid_grant`.
- Unknown refresh tokens return `invalid_grant`.
- Added refresh grant compatibility fixture.
- Updated current-state docs and Week 7 spec.
  Verification:
- `pnpm test test/app.test.ts` passed with 22 tests.
- `pnpm check` passed after route integration.
  Remaining risks:
- Live successful refresh requires local or deployed secrets and seeded token data.

## Integration Decisions

Accepted:

Rejected:

Conflicts:

Remaining risks:

Verification still needed:
