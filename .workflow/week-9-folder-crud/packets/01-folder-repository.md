Packet ID: 01-folder-repository
Objective: Add owner-scoped folder persistence.
Context: D1 already has `folders` with encrypted names and soft-delete fields.
Files / sources: `src/repositories/folder-repository.ts`, repository tests.
Ownership: Folder D1 access only.
Do: Implement list, create, update, and soft delete by authenticated user ID.
Do not: Add ciphers or plaintext folder fields.
Expected output: Folder repository tests pass.
Verification: `pnpm test test/repositories/folder-repository.test.ts`.
