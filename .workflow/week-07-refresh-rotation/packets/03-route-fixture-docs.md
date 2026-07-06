Packet ID: 03-route-fixture-docs
Objective: Wire refresh grant into `POST /identity/connect/token`.
Context: Password grant route exists and returns fixture-compatible token fields.
Files / sources: `src/app.ts`, `test/app.test.ts`, `compat/fixtures/token`, docs/specs.
Ownership: HTTP integration, fixture, docs.
Do: Add successful refresh tests, reuse invalidation tests, fixture, current-state docs.
Do not: Add access-token auth middleware or vault sync.
Expected output: App tests and compat tests pass.
Verification: `pnpm test test/app.test.ts` and `pnpm compat:test`.
