# Packet 02: Recent Auth Guard

Objective: require recent password authentication for sensitive TOTP setup operations.

Ownership:

- `src/app.ts`
- `test/app.test.ts`

Expected output:

- Generic bearer authentication remains usable for normal API routes.
- Sensitive TOTP setup routes require password-auth access tokens issued within five minutes.
- Stale password-auth tokens, refresh-auth tokens, and legacy claimless tokens fail closed with `reauth_required`.

Verification:

- App tests cover positive TOTP setup, stale token rejection, refresh-token rejection, claimless-token rejection, and unchanged sync behavior with legacy tokens.
