# Week 6 Token Exchange

## Goal

Implement the first password grant token exchange for bootstrapped users while storing refresh tokens only as hashes and preserving compatibility fixture shape.

## Success Criteria

- `POST /identity/connect/token` accepts password grant form bodies.
- Valid credentials return a signed access token and one-time refresh token.
- Refresh token plaintext is never stored in D1.
- Device information is required and recorded.
- Invalid grant responses do not distinguish unknown user from wrong password.
- Missing token secret fails closed.
- Full local and CI checks pass.

## Current Context

- Week 5 bootstrap endpoint is pushed and CI-green.
- D1 schema already has `users`, `devices`, and `refresh_tokens`.
- Token success fixture exists under `compat/fixtures/token/password-grant-success.json`.

## Constraints

- Do not commit real secrets.
- Keep route handlers thin.
- Do not add public registration.
- Do not implement refresh rotation in this slice unless it falls out naturally.
- Keep upstream-provider brand strings out of tracked files.

## Risks

- Token responses can leak secret material or diverge from official client expectations.
- Refresh token plaintext could be accidentally stored.
- Missing device handling can cause client errors or orphan tokens.
- Access token signing must fail closed when secret is absent.

## Approval Required

No extra approval for local implementation and tests. Ask before setting real Cloudflare secrets, deploying, or creating remote resources.

## Work Packets

- `01-token-domain`: form parsing, grant validation, token signing, refresh hashing.
- `02-auth-repository`: user lookup, device upsert, refresh token hash insert.
- `03-route-integration`: Hono endpoint and response/error shapes.
- `04-verification`: checks, smoke tests where safe, push, CI.

## Integration Policy

Parent agent integrates packet results. Security findings block push until fixed.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- local smoke for failure-safe paths without real secrets

## Reusable Artifacts

- `.workflow/week-06-token-exchange/`
