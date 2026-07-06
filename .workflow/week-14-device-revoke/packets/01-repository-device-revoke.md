Packet ID: 01-repository-device-revoke
Objective: Add owner-scoped active device revoke storage behavior.
Context: Device rows already have `revoked_at`; refresh grants already reject revoked devices.
Files / sources: `src/repositories/auth-repository.ts`, `test/repositories/auth-repository.test.ts`.
Ownership: Repository update contract and SQL predicates.
Do: Mark only active owner-scoped target devices revoked, then revoke active refresh rows for cleanup.
Do not: Add schema changes or expose token hashes.
Expected output: Repository tests cover revoked and not-found outcomes.
Verification: `pnpm test -- test/repositories/auth-repository.test.ts --run`.
