Packet ID: 02-route-conflicts
Objective: Require caller-observed revision values on update routes and map stale writes to `409`.
Context: Update routes previously allowed requests without an expected revision and collapsed failed writes to `404`.
Files / sources: `src/app.ts`, `test/app.test.ts`, `test/support/fake-d1.ts`.
Ownership: Request validation, response mapping, and fake D1 behavior.
Do: Require non-empty update `revisionDate`; preserve create request behavior; return `404` for missing owner-scoped active rows and `409 revision_conflict` for stale rows.
Do not: Decrypt or reinterpret cipher payloads; expose cross-user row existence.
Expected output: HTTP tests cover success, missing revision, missing row, and stale row outcomes.
Verification: `pnpm test -- test/app.test.ts --run`.
