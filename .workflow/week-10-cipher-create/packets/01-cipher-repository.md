Packet ID: 01-cipher-repository
Objective: Add user-scoped cipher persistence.
Context: D1 already has `ciphers` with encrypted JSON and soft-delete fields.
Files / sources: `src/repositories/cipher-repository.ts`, repository tests.
Ownership: Cipher D1 access only.
Do: Implement list active ciphers and create cipher.
Do not: Add update, delete, restore, or plaintext fields.
Expected output: Cipher repository tests pass.
Verification: `pnpm test test/repositories/cipher-repository.test.ts`.
