# HON-55 TOTP And Recent-Auth Live Evidence Final Report

## Result

Completed local synthetic TOTP and recent-auth lifecycle evidence for the CLI
`2026.6.0` surface and related HTTP account-management routes.

## Evidence

- `docs/release/totp-recent-auth-live-evidence.md`
- `compat/client-matrix.json`
- `test/.tmp/hon-55-totp-recent-auth/evidence/totp-recent-auth-live.redacted.json`
  remained ignored and local-only.

## Implementation Finding

The official CLI one-step TOTP login shape sends the six-digit OTP in the TOTP
token field. The server now accepts that shape while preserving the existing
challenge-backed token plus code flow.

## Verification

- Official CLI login returned a session key length of `88`.
- Challenge-backed HTTP TOTP login returned HTTP `200`.
- Refresh-auth token use on TOTP disable returned `reauth_required`.
- TOTP setup, change, disable, and revoke-all-other-sessions returned expected
  local HTTP statuses.
- Focused and full repository verification are recorded in the PR.

## Remaining Limits

Browser-extension, desktop, Android, and iOS TOTP UX remain unproven. This
evidence does not promote any row to `live_regression`.
