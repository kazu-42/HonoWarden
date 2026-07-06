Packet ID: 02-schema-repository
Objective: Add schema and repository support for login defenses.
Context: Account lockout must persist, and IP rate limiting needs attempt buckets.
Files / sources: `migrations/0002_login_defenses.sql`, `src/repositories/auth-repository.ts`, `test/repositories/auth-repository.test.ts`, `test/migrations.test.ts`, `test/support/fake-d1.ts`.
Ownership: Persistence layer.
Do: Add account failure columns, auth attempt table, indexes, count/record/reset repository operations, and test support.
Do not: Store plaintext IP addresses or real credentials.
Expected output: Repository operations are tested and migration is validated.
Verification: Repository and migration tests.
