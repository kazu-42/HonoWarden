# Result 01: Token Claims

Accepted:

- Added optional `authMethod` to access token claims.
- New password-grant access tokens carry `authMethod: "password"`.
- New refresh-grant access tokens carry `authMethod: "refresh"`.
- Legacy claimless tokens remain valid for generic bearer authentication.
- Unknown auth method values are rejected during token verification.

Rejected:

- Making `authMethod` mandatory for all token verification, because that would break existing generic bearer tokens.

Verification:

- `pnpm test -- test/domain/tokens.test.ts test/app.test.ts`
- `pnpm check`
