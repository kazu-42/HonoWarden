# Week 19 Recent Reauth

## Goal

Add a recent re-authentication guard for sensitive account operations, starting with TOTP setup and setup verification.

## Success Criteria

- Access tokens include an authentication method claim for newly issued tokens.
- Password-grant tokens carry `authMethod: "password"`.
- Refresh-grant tokens carry `authMethod: "refresh"`.
- Existing token verification remains backward-compatible for tokens without the new claim.
- TOTP setup and setup verification require a token issued by recent password authentication.
- Stale password-auth tokens and refresh-auth tokens are rejected with structured `401` responses.
- Existing non-sensitive API routes continue accepting valid bearer tokens.

## Current Context

Week 18 added authenticated TOTP setup and setup verification. Those routes currently require only a valid bearer token. Roadmap Week 19 requires sensitive operations to reject JWT-only access without recent re-auth.

## Constraints

- Keep the implementation API-only.
- Do not implement backup export or revoke-all sessions in this slice.
- Preserve compatibility for existing access-token verification tests.
- Do not leave direct external provider brand strings in source or docs.

## Risks

- If refresh-issued access tokens are not distinguished from password-issued access tokens, refresh rotation can bypass recent re-auth.
- If recent-auth checks compare wall-clock values inconsistently, legitimate setup attempts can fail.
- If all authenticated routes require recent auth, normal sync and CRUD routes will regress.

## Approval Required

No approval is required for local code, tests, docs, git push, and CI. Live deploys, live migrations, production secret changes, and live client attempts remain approval-gated.

## Work Packets

- `01-token-claims`: Add optional auth method claim and tests for password vs refresh issuance.
- `02-recent-auth-guard`: Add authenticated recent-auth helper and route tests for TOTP setup/verify.
- `03-docs-verification`: Update docs/workflow and run local gates, brand scan, workflow verifier, push, and CI.

## Integration Policy

Keep the guard narrow. Sensitive routes opt into recent-auth; existing sync, folder, cipher, refresh, and device revoke behavior should not change in this slice.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI

## Reusable Artifacts

The auth method claim and recent-auth helper should be reusable for future export backup, revoke-all sessions, and TOTP disable flows.
