Packet ID: 03-security-review
Objective: Review bootstrap security and operational risks.
Context: Endpoint creates initial users and therefore must not become public self-service registration.
Files / sources: `src/domain/bootstrap.ts`, `src/repositories/user-repository.ts`, `src/app.ts`, `migrations/0001_initial_schema.sql`, tests.
Ownership: Review notes only unless a blocking issue is found.
Do: Check default-deny, token validation, allowlist, duplicate insert, storage fields, response leakage.
Do not: Broaden scope into token exchange or vault sync.
Expected output: Result note with accepted fixes and remaining risks.
Verification: Findings map to tests or code references.
