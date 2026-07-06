Packet ID: 02-auth-helper
Objective: Share protected-route authentication.
Context: Week 8 sync has inline bearer-token verification and user re-load.
Files / sources: `src/app.ts`, `test/app.test.ts`.
Ownership: Route-level auth helper.
Do: Extract helper without changing existing sync auth behavior.
Do not: Change token issuance.
Expected output: Existing sync auth tests continue to pass.
Verification: `pnpm test test/app.test.ts`.
