# Packet 01: Token Claims

Objective: distinguish password-auth and refresh-auth access tokens.

Ownership:

- `src/domain/tokens.ts`
- `src/app.ts`
- `test/domain/tokens.test.ts`
- `test/app.test.ts`

Expected output:

- `AccessTokenClaims` has optional `authMethod`.
- `verifyAccessToken` accepts missing auth method for legacy tokens.
- `verifyAccessToken` rejects unknown auth method values.
- Password grant issues `authMethod: "password"`.
- Refresh grant issues `authMethod: "refresh"`.

Verification:

- Focused token-domain and app tests pass.
