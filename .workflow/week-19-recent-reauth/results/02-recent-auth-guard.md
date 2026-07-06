# Result 02: Recent Auth Guard

Accepted:

- Added a sensitive-route helper requiring recent password-auth tokens.
- Applied the helper only to TOTP setup and setup verification.
- Preserved normal API behavior for legacy claimless bearer tokens.
- Added tests for stale password tokens, refresh-auth tokens, and claimless tokens failing TOTP setup.

Rejected:

- Applying recent-auth to all authenticated routes in this slice.
- Treating missing `authMethod` as password auth on sensitive routes.

Verification:

- `pnpm test -- test/domain/tokens.test.ts test/app.test.ts`
- `pnpm check`
