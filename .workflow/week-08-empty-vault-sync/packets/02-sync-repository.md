Packet ID: 02-sync-repository
Objective: Add user lookup by ID for authenticated routes.
Context: Auth repository can lookup users by email.
Files / sources: `src/repositories/auth-repository.ts`, repository tests.
Ownership: D1 auth user lookup.
Do: Add `findAuthUserById`.
Do not: Add vault item queries yet.
Expected output: Repository tests pass.
Verification: `pnpm test test/repositories/auth-repository.test.ts`.
