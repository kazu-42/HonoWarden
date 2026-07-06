Packet ID: 02-refresh-repository
Objective: Add refresh token lookup, rotation, and session invalidation repository helpers.
Context: `refresh_tokens` stores hash, expiry, revoke date, and rotation parent.
Files / sources: `src/repositories/auth-repository.ts`, `test/repositories/auth-repository.test.ts`.
Ownership: D1 refresh token state transitions.
Do: Lookup by hash with user/device context, conditionally revoke old token, insert child token hash, invalidate session on reuse.
Do not: Store token plaintext.
Expected output: Repository tests prove hash-only rotation and invalidation.
Verification: `pnpm test test/repositories/auth-repository.test.ts`.
