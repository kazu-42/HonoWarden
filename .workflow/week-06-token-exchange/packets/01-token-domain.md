Packet ID: 01-token-domain
Objective: Implement token domain helpers.
Context: Password grant only; refresh token plaintext must not be stored.
Files / sources: `src/domain/tokens.ts`, `test/domain/tokens.test.ts`.
Ownership: Pure token/form/crypto helpers.
Do: Parse form, normalize grant input, sign access tokens, generate refresh tokens, hash refresh tokens.
Do not: Touch D1 directly.
Expected output: Domain tests pass.
Verification: `pnpm test test/domain/tokens.test.ts`.
