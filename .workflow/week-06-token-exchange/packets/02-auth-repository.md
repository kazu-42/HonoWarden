Packet ID: 02-auth-repository
Objective: Implement auth repository helpers.
Context: D1 schema has users/devices/refresh_tokens from Week 2.
Files / sources: `src/repositories/auth-repository.ts`, repository tests.
Ownership: D1 lookup and session persistence.
Do: Lookup user auth row by normalized email, upsert device, insert hashed refresh token.
Do not: Store refresh token plaintext.
Expected output: Repository tests pass.
Verification: `pnpm test test/repositories/auth-repository.test.ts`.
