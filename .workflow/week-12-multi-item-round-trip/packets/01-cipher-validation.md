Packet ID: 01-cipher-validation
Objective: Accept secure-note cipher type without weakening validation.
Context: Cipher create/update currently accept login cipher type only.
Files / sources: `src/app.ts`, `test/app.test.ts`.
Ownership: Request validation and DTO behavior.
Do: Allow type `2`, keep unsupported types rejected, keep server metadata authoritative.
Do not: Add schema changes or plaintext fields.
Expected output: App tests pass.
Verification: `pnpm test test/app.test.ts`.
