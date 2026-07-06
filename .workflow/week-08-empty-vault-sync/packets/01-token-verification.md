Packet ID: 01-token-verification
Objective: Add access token verification.
Context: `signAccessToken` already emits HMAC compact tokens.
Files / sources: `src/domain/tokens.ts`, `test/domain/tokens.test.ts`.
Ownership: Token verification helper.
Do: Verify signature, decode claims, check expiration.
Do not: Query D1.
Expected output: Token verification tests pass.
Verification: `pnpm test test/domain/tokens.test.ts`.
