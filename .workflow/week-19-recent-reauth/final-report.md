# Final Report: Week 19 Recent Reauth

## Outcome

Week 19 recent re-auth is implemented locally for the TOTP setup surface. Newly issued access tokens distinguish password authentication from refresh-token rotation, and sensitive TOTP setup routes require a password-auth token issued within five minutes.

## Accepted Results

- Password grant emits `authMethod: "password"`.
- Refresh grant emits `authMethod: "refresh"`.
- Legacy claimless tokens remain valid for normal authenticated API routes.
- TOTP setup and setup verification reject stale password tokens, refresh-issued tokens, and claimless tokens.
- The recent-auth requirement is narrowly scoped to sensitive TOTP setup routes in this slice.

## Rejected Results

- Requiring `authMethod` on every token verification.
- Allowing claimless tokens to satisfy recent-auth.
- Applying recent-auth to ordinary sync and vault CRUD routes.

## Conflicts Resolved

- Chose compatibility for generic bearer auth and fail-closed behavior for sensitive route auth.

## Verification Evidence

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan: no hits
- workflow verifier: passed
- GitHub Actions CI run `28793695973`: passed
  - https://github.com/kazu-42/HonoWarden/actions/runs/28793695973

## Remaining Risks

- Backup export and revoke-all-session routes do not exist yet, so their re-auth gates are future work.
- No live client evidence is recorded for recent-auth behavior.

## Reusable Follow-up

- Reuse `authenticateRecentPasswordRequest` for future backup export, revoke-all, TOTP disable, and TOTP change flows.
