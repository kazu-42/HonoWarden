Packet ID: 01-refresh-domain
Objective: Add refresh grant parsing and reusable token response helpers.
Context: Password grant helpers exist in `src/domain/tokens.ts`.
Files / sources: `src/domain/tokens.ts`, `test/domain/tokens.test.ts`.
Ownership: Pure domain helpers.
Do: Parse `grant_type=refresh_token`, validate `refresh_token`, keep invalid request shape stable.
Do not: Touch D1.
Expected output: Domain tests pass.
Verification: `pnpm test test/domain/tokens.test.ts`.
