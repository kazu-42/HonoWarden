Packet ID: 02-route-device-revoke
Objective: Add authenticated device revoke route with current-device guard.
Context: Protected API auth currently returns the user but can also return the verified access-token device identifier.
Files / sources: `src/app.ts`, `test/app.test.ts`, `test/support/fake-d1.ts`.
Ownership: Route validation, auth context, response mapping, fake D1 updates.
Do: Use verified token claims, block self-revoke, return `404` for missing targets, and return a stable revoke response.
Do not: Parse tokens twice or reveal cross-user devices.
Expected output: HTTP tests cover success, self-revoke rejection, and missing target.
Verification: `pnpm test -- test/app.test.ts --run`.
