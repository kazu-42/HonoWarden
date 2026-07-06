Packet ID: 02-round-trip-tests
Objective: Prove encrypted payload round-trip reliability.
Context: Cipher payloads are stored as JSON strings and merged into responses.
Files / sources: `test/app.test.ts`, `test/support/fake-d1.ts`.
Ownership: HTTP acceptance tests.
Do: Test secure-note create, unknown fields on create/update, favorites, and 50 cipher sync.
Do not: Add pagination or real client traffic fixtures.
Expected output: App tests pass.
Verification: `pnpm test test/app.test.ts`.
