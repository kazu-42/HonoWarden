Packet ID: 01-runtime-environment
Objective: Add runtime environment resolution and health response visibility.
Context: Week 16 needs staging and production separation to be easy to verify during dogfood.
Files / sources: `src/infra/environment.ts`, `src/app.ts`, `test/infra/environment.test.ts`, `test/app.test.ts`.
Ownership: Runtime environment logic and health response tests.
Do: Resolve only `development`, `staging`, and `production`; fall back to `development` for missing or unknown values; expose the resolved environment in health responses.
Do not: Expose secrets, allowlists, database IDs, bucket names, or client data.
Expected output: Health responses include a safe `environment` field.
Verification: Targeted tests, `pnpm check`, and `pnpm test`.
