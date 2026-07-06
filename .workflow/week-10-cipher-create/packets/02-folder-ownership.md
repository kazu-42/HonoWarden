Packet ID: 02-folder-ownership
Objective: Validate optional folder ownership for cipher create.
Context: Week 9 folder repository has owner-scoped folder writes.
Files / sources: `src/repositories/folder-repository.ts`, folder repository tests.
Ownership: Folder existence check only.
Do: Add an active folder ownership check by user ID and folder ID.
Do not: Add folder mutation behavior.
Expected output: Folder repository tests pass.
Verification: `pnpm test test/repositories/folder-repository.test.ts`.
