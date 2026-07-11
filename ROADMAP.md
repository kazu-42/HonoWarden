# Roadmap

HonoWarden will be developed incrementally. The goal is not to design a full upstream-compatible vault server up front, but to keep every weekly state deployable, testable, and more useful than the previous one.

Start date: 2026-07-06  
Initial six-month target: 2027-01-03  
Target release: `v0.1.0-alpha`

The current post-alpha execution sequence, Linear hierarchy, usable-state exit
criteria, and issue-capacity policy are maintained in
[docs/implementation-plan.md](docs/implementation-plan.md). The six-month
schedule below remains the historical product roadmap; the implementation plan
is authoritative for current delivery order.

## Target For v0.1.0-alpha

HonoWarden should let official upstream browser extension, desktop, and mobile clients connect to a self-hosted URL and use a minimal personal vault:

- restricted account bootstrap for one person or a small set of allowed users
- password login
- refresh token rotation
- empty vault sync
- folders
- login item cipher create, update, delete, and restore
- multi-device sync
- device session revoke
- TOTP two-factor login
- D1 backup and restore runbook
- minimal audit logs and operator documentation

## Explicit Non-Goals For The First Six Months

- Web Vault
- public registration UI
- Organizations
- Collections sharing
- Send
- Icon proxy
- Passkey login
- enterprise policies
- emergency access

These are deferred because they expand the attack surface or require a separate permission model.

## Development Rules

- Cut a deployable tag at the end of each week.
- Prefer official upstream client verification over curl-only verification once an endpoint is reachable by clients.
- Fix compatibility regressions before adding new features.
- Capture incoming and outgoing compatibility JSON as fixtures.
- Keep the project API-only; do not add a Web Vault.
- Put new risky features behind feature flags.
- Check authorization, ownership, and revision state before persisting D1/R2 changes.
- Unsupported feature surfaces should fail explicitly with `403` or `501`; they should not silently no-op.

## Six-Month Schedule

| Week | Dates                    | Working Increment                                         | Core Acceptance Criteria                                                                                                                      |
| ---- | ------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 2026-07-06 to 2026-07-12 | HonoWarden exists as a Cloudflare Workers API shell.      | `GET /health` and `GET /api/config` return JSON; CI passes; request IDs, structured errors, and security headers exist.                       |
| 2    | 2026-07-13 to 2026-07-19 | D1 migrations and DB health exist.                        | Initial `users`, `devices`, `refresh_tokens`, `folders`, and `ciphers` schema can be migrated locally; `/health/db` returns migration status. |
| 3    | 2026-07-20 to 2026-07-26 | Compatibility fixture harness exists.                     | Fixtures cover `prelogin`, `token`, and empty `sync` shapes; `pnpm compat:test` passes.                                                       |
| 4    | 2026-07-27 to 2026-08-02 | Allowlisted users can receive `prelogin` KDF parameters.  | `POST /identity/accounts/prelogin` returns KDF fields for allowed email addresses and rejects unsupported registration surfaces.              |
| 5    | 2026-08-03 to 2026-08-09 | One-time bootstrap registration works.                    | Bootstrap is default-off, allowlisted, and resistant to duplicate parallel registration.                                                      |
| 6    | 2026-08-10 to 2026-08-16 | Password grant returns tokens.                            | `POST /identity/connect/token` returns access and refresh tokens for valid credentials; refresh tokens are not stored in plaintext.           |
| 7    | 2026-08-17 to 2026-08-23 | Device records and refresh token rotation work.           | Login records a device; refresh rotates tokens; token reuse invalidates the session.                                                          |
| 8    | 2026-08-24 to 2026-08-30 | Official upstream clients can log in to an empty vault.   | Browser extension and desktop login succeed; `/api/sync` returns empty vault collections without client errors.                               |
| 9    | 2026-08-31 to 2026-09-06 | Folder CRUD works.                                        | Official upstream clients can create, edit, delete, and sync folders; cross-user folder access is denied.                                     |
| 10   | 2026-09-07 to 2026-09-13 | One login item can be created.                            | Official upstream clients can create a login cipher, sync it, and see it after logout/login.                                                  |
| 11   | 2026-09-14 to 2026-09-20 | Cipher edit, delete, restore, and permanent delete work.  | Create, edit, trash, restore, and permanent delete work from official clients.                                                                |
| 12   | 2026-09-21 to 2026-09-27 | A 10 to 50 item vault syncs reliably.                     | Login items, notes, favorites, and unknown encrypted fields round-trip without server-side decryption.                                        |
| 13   | 2026-09-28 to 2026-10-04 | Stale updates are handled safely.                         | Revision tests prevent destructive overwrite from stale clients.                                                                              |
| 14   | 2026-10-05 to 2026-10-11 | Device revoke works.                                      | One device can revoke another; refresh fails after revocation.                                                                                |
| 15   | 2026-10-12 to 2026-10-18 | Client compatibility matrix exists.                       | Browser extension, desktop, mobile, and CLI coverage is documented with exact client versions and known issues.                               |
| 16   | 2026-10-19 to 2026-10-25 | Low-risk dogfood starts.                                  | Staging and production are separated; low-risk vault entries sync for one week without daily breakage.                                        |
| 17   | 2026-10-26 to 2026-11-01 | Login defenses exist.                                     | IP and account-based rate limits, temporary lockout, and safe error wording are tested.                                                       |
| 18   | 2026-11-02 to 2026-11-08 | TOTP login works.                                         | TOTP setup, verification, login challenge, invalid code rejection, and replay rejection are tested.                                           |
| 19   | 2026-11-09 to 2026-11-15 | Sensitive operations require recent re-auth.              | JWT alone cannot change TOTP, export backup, or revoke all sessions.                                                                          |
| 20   | 2026-11-16 to 2026-11-22 | Backup and restore work.                                  | A production-like D1 backup restores into a new D1 database and clients can login/sync afterward.                                             |
| 21   | 2026-11-23 to 2026-11-29 | Observability exists.                                     | Auth failures, device revokes, backups, and admin actions are auditable without logging secrets.                                              |
| 22   | 2026-11-30 to 2026-12-06 | Compatibility regression suite is broad enough for alpha. | Empty vault, one cipher, folder, deleted cipher, TOTP, and refresh rotation fixtures pass in CI.                                              |
| 23   | 2026-12-07 to 2026-12-13 | Two to three users can dogfood separately.                | Alice and Bob have isolated personal vaults; disabled users cannot login or refresh.                                                          |
| 24   | 2026-12-14 to 2026-12-20 | Security review materials exist.                          | Threat model, data flow, auth state machine, secrets inventory, and known limitations are documented.                                         |
| 25   | 2026-12-21 to 2026-12-27 | Feature freeze.                                           | Fresh deploy guide, upgrade guide, rollback guide, release notes, and frozen migrations exist.                                                |
| 26   | 2026-12-28 to 2027-01-03 | `v0.1.0-alpha` is tagged.                                 | Browser extension, desktop, and mobile can login/sync; backup/restore works; unsupported features are listed.                                 |

## Implementation Order

1. `/health`
2. `/api/config`
3. D1 schema
4. `/identity/accounts/prelogin`
5. restricted `/api/accounts/register`
6. `/identity/connect/token`
7. refresh token rotation
8. `/api/sync` for an empty vault
9. folders CRUD
10. ciphers create
11. ciphers update, delete, and restore
12. device/session revoke
13. TOTP
14. backup/restore
15. hardening and docs

## Target Directory Shape

```text
src/
  routes/
  domain/
  repositories/
  protocol/
  infra/

migrations/
compat/
docs/
```

Hono should remain the HTTP boundary. Route handlers should stay thin, with compatibility DTOs, domain rules, and storage code split out as the codebase grows.

## Weekly Definition Of Done

- staging deploy completed
- `pnpm check` passes
- `pnpm lint` passes
- `pnpm test` passes
- compatibility fixtures pass once introduced
- migration rollback path is known once migrations exist
- [docs/current-state.md](docs/current-state.md) is updated
- unsupported feature behavior is explicit
- no secret, password, token, vault export, or plaintext vault data appears in logs or fixtures
