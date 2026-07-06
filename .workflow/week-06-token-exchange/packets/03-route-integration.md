Packet ID: 03-route-integration
Objective: Add `POST /identity/connect/token`.
Context: Route must remain thin and return fixture-compatible token response.
Files / sources: `src/app.ts`, `test/app.test.ts`, specs/docs.
Ownership: HTTP parsing, status mapping, response DTO.
Do: Wire password grant, require device identifier, require token secret, return stable errors.
Do not: Implement refresh grant yet.
Expected output: HTTP tests pass.
Verification: `pnpm test test/app.test.ts`.
