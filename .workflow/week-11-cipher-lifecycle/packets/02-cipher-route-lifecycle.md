Packet ID: 02-cipher-route-lifecycle
Objective: Add authenticated cipher lifecycle routes.
Context: Protected-route auth, cipher create, folder ownership check already exist.
Files / sources: `src/app.ts`, `test/app.test.ts`.
Ownership: HTTP routes and DTOs.
Do: Implement update, trash, restore, and permanent delete routes.
Do not: Add attachments or collections.
Expected output: HTTP tests pass.
Verification: `pnpm test test/app.test.ts`.
