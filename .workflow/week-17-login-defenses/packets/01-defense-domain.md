Packet ID: 01-defense-domain
Objective: Add pure login-defense policy helpers.
Context: Password grant needs account lockout and IP buckets without leaking account existence.
Files / sources: `src/domain/login-defense.ts`, `test/domain/login-defense.test.ts`.
Ownership: Domain policy only.
Do: Compute lockout state, reset state, retry-after seconds, safe hashed buckets, and client address extraction.
Do not: Touch D1, route handlers, secrets, or live data.
Expected output: Deterministic helpers with tests.
Verification: Targeted domain tests.
