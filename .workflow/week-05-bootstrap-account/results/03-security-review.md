# Packet 03 Result: Security Review

Accepted:

- Bootstrap is default-off via `HONOWARDEN_BOOTSTRAP_ENABLED`.
- Empty or missing `HONOWARDEN_BOOTSTRAP_TOKEN` cannot authorize bootstrap.
- Presented token is compared without early return on matching prefixes.
- Email is normalized before allowlist comparison and before D1 uniqueness checks.
- D1 schema has `email_normalized TEXT NOT NULL UNIQUE`.
- Duplicate bootstrap attempts return `409` through `INSERT OR IGNORE` and `meta.changes`.
- Public registration endpoints still return `403`.
- Error responses do not expose SQL or secret details.

Rejected:

- No real Cloudflare secrets were set.
- No production data, billing, or real user accounts were touched.
- No Cloudflare deploy was performed.

Decision:

- Keep bootstrap as an operator endpoint outside the public registration surface.

Remaining risks:

- `masterPasswordHash` format is not cryptographically validated yet. This is acceptable for the current bootstrap slice but must be tightened with auth/token implementation and operator docs.

Verification:

- Security invariants are covered by `test/domain/bootstrap.test.ts`, `test/repositories/user-repository.test.ts`, and `test/app.test.ts`.
