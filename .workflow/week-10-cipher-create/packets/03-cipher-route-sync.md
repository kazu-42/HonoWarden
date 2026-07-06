Packet ID: 03-cipher-route-sync
Objective: Add cipher create route and sync inclusion.
Context: Protected-route auth and folder CRUD already exist.
Files / sources: `src/app.ts`, `test/app.test.ts`, docs/spec.
Ownership: HTTP route and DTOs.
Do: Validate metadata, persist opaque JSON, return created cipher, include ciphers in sync.
Do not: Implement cipher update/delete/restore.
Expected output: HTTP tests pass.
Verification: `pnpm test test/app.test.ts`.
