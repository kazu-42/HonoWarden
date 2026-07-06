Packet ID: 01-cipher-repository-lifecycle
Objective: Add owner-scoped cipher lifecycle repository functions.
Context: Cipher create/list exists and stores encrypted JSON opaquely.
Files / sources: `src/repositories/cipher-repository.ts`, repository tests.
Ownership: Cipher D1 access only.
Do: Implement update, trash, restore, and permanent delete.
Do not: Add route handling or plaintext fields.
Expected output: Cipher repository tests pass.
Verification: `pnpm test test/repositories/cipher-repository.test.ts`.
