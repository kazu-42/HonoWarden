Packet ID: 03-sync-route
Objective: Add authenticated `GET /api/sync`.
Context: Empty sync fixture exists.
Files / sources: `src/app.ts`, `test/app.test.ts`, docs/spec.
Ownership: HTTP route and DTO.
Do: Require bearer token, verify claims, load user, return empty sync response.
Do not: Add folders or ciphers yet.
Expected output: HTTP tests pass.
Verification: `pnpm test test/app.test.ts`.
