Packet ID: 02-bootstrap-implementation
Objective: Implement Week 5 bootstrap account creation.
Context: Weeks 1-4 are pushed. Bootstrap must be private, default-off, token-gated, and allowlist-gated.
Files / sources: `src/domain/bootstrap.ts`, `src/repositories/user-repository.ts`, `src/app.ts`, `wrangler.jsonc`, `worker-configuration.d.ts`, tests, specs, docs.
Ownership: Bootstrap implementation and tests.
Do: Add domain/repository/route tests, implement route, regenerate types, document behavior.
Do not: Add public registration, real secrets, or plaintext password fields.
Expected output: Passing local tests for bootstrap behavior.
Verification: `pnpm check`, `pnpm lint`, `pnpm test`.
