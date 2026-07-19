# Packet 03 result: routes and projections

## Implementation

- Added default-off authenticated `GET /api/accounts/keys` and one-time V1
  `POST /api/accounts/keys` routes behind
  `HONOWARDEN_ACCOUNT_KEYS_ENABLED`.
- Tracked the false default in `.env.example`, all three Wrangler environments,
  generated Worker bindings, and operator rollout/rollback documentation.
- Added one complete-state projection for token, refresh-token, profile, sync,
  backup, and account-key responses. Missing state projects null only on the
  established surfaces; partial state fails without returning the surviving
  value.
- Exact POST replay is a no-op. A concurrent exact retry succeeds only when the
  authenticated security stamp still matches; replacement, stale-stamp, and
  partial-state outcomes remain conflicts.
- Password, TOTP, auth-request, and refresh-token flows construct the projection
  before challenge consumption, session creation, or token rotation.
- Bootstrap rejects partial pairs and complete pairs without a wrapped user key
  before D1, so supported account creation cannot seed an unusable projection.
- Profile updates and backup exports validate the projection before the user
  update or successful export audit can commit.

## Invariants proved

- Disabled GET and POST return before authentication or D1 access.
- Unsupported V2, unknown, partial, padded, controlled, or oversized input
  cannot reach the account-key mutation.
- First initialization advances account revision, emits one redacted required
  audit event, and preserves the security stamp, devices, refresh tokens, and
  pending auth requests.
- Exact replay and concurrent exact retry do not add an audit event or advance
  revision a second time.
- A concurrent security-stamp rotation cannot be mistaken for an idempotent
  retry, even when the resulting keypair has the requested values.
- Partial stored state cannot consume a TOTP challenge, create a password-grant
  session, rotate a refresh token, or disclose either surviving value.
- Projection failure cannot leave a committed profile update or a successful
  audit for a backup that was not returned.

## Verification

- Focused domain/repository/API/environment/docs suite: 5 files / 352 tests
  passed.
- TypeScript `pnpm check`: passed.
- Repository-wide `pnpm lint`: passed.
- `git diff --check`: passed.

No deployment, remote D1 mutation, real-account key change, flag activation, or
session invalidation occurred.
