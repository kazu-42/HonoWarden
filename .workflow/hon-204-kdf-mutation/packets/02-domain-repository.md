# Packet 02: domain and repository

Objective: parse exactly one valid KDF generation and commit it atomically.

Ownership: `src/domain/account-credentials.ts`,
`src/repositories/credential-repository.ts`, and their focused tests.

Do: use red/green/refactor; cover every inclusive boundary, just-outside value,
mixed data, salt drift, stale guards, concurrency, and each failed D1 statement.

Do not: loosen password-change validation or expose credential material in audit
events.

Verification: focused Vitest files and FakeD1 rollback assertions.
