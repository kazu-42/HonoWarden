# Integration Checklist: week-05-bootstrap-account

## 01 Skill Install

# Packet 01 Result: Skill Install

Accepted:

- Installed project-local `codex-dynamic-workflows` skill under `.codex/skills/codex-dynamic-workflows`.
- Added `/dynamic` wrapper documentation under `.codex/commands/dynamic.md`.
- Scaffolded workflow artifacts under `.workflow/week-05-bootstrap-account`.
  Rejected:
- Did not claim local scripts can spawn real subagents. This run uses simulated packet passes.
  Verification:
- Skill files are present.
- Workflow packet files are present.
  Remaining risks:
- Slash-command discovery depends on the host client honoring `.codex/commands`.

## 02 Bootstrap Implementation

# Packet 02 Result: Bootstrap Implementation

Accepted:

- Added bootstrap domain logic for enable flag parsing, token comparison, allowlist validation, and D1 record construction.
- Added D1 repository insert with `INSERT OR IGNORE`.
- Added `POST /api/accounts/bootstrap`.
- Kept public registration endpoints disabled.
- Added domain, repository, and HTTP route tests.
- Updated `wrangler.jsonc`, generated Workers types, specs, README, and current-state docs.
  Rejected:
- Did not implement token exchange or real login.
- Did not enable bootstrap by default.
- Did not commit a real bootstrap token.
  Verification:
- `pnpm check` passed.
- `pnpm lint` passed.
- `pnpm test` initially caught a repository policy violation in the workflow plan; after removing the direct string, `pnpm test` passed with 40 tests.
- `pnpm compat:test` passed.
  Remaining risks:
- Bootstrap caller must provide a password hash and encrypted key material; server-side cryptographic verification arrives with the token/login implementation.

## 03 Security Review

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

## Integration Decisions

Accepted:

Rejected:

Conflicts:

Remaining risks:

Verification still needed:
