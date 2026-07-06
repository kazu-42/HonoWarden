Packet ID: 03-folder-routes
Objective: Add folder create, update, delete, and sync inclusion.
Context: Repository packet provides owner-scoped folder persistence.
Files / sources: `src/app.ts`, `test/app.test.ts`, docs/spec.
Ownership: HTTP routes and DTOs.
Do: Validate folder body, call repository functions, return stable JSON, include folders in sync.
Do not: Implement cipher CRUD or collections.
Expected output: HTTP tests pass.
Verification: `pnpm test test/app.test.ts`.
