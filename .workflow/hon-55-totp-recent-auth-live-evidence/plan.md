# HON-55 TOTP And Recent-Auth Live Evidence Plan

## Goal

Capture redacted live evidence for TOTP login and recent-auth sensitive-route
guards using only synthetic local state before closing `HON-55`.

## Scope

- Use the tracked official CLI `2026.6.0` for the TOTP login client path.
- Use local wrangler dev and local D1 only.
- Use a synthetic account and ignored local secret material only.
- Prove TOTP setup, official CLI one-step TOTP login, challenge-backed HTTP
  TOTP login, refresh-grant behavior, recent-auth rejection for refresh tokens,
  TOTP change, TOTP disable, and revoke-all-other-sessions.
- Record only redacted evidence in committed docs.

## Non-Goals

- Production, staging, or remote D1 writes.
- Browser-extension, desktop, Android, or iOS TOTP UX evidence.
- Autonomous account-management UI proof for flows the tracked CLI does not
  expose in this scope.
- Full `live_regression` promotion.

## Guardrails

- Do not commit generated TOTP seeds, account keys, passwords, tokens, session
  keys, or raw client state.
- Preserve the TOTP replay invariant by waiting for a new 30-second timestep
  before reusing a synthetic TOTP secret.
- Keep matrix promotion conservative: add evidence to the CLI `live_smoke` row
  without claiming desktop, mobile, browser TOTP UX, or `live_regression`.
