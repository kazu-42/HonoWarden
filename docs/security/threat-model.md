# Security Threat Model

Last reviewed: 2026-07-06.

HonoWarden is pre-alpha. This model documents the current implementation and
the controls that must be true before `v0.1.0-alpha` is tagged. It is not an
independent security audit.

## Scope

In scope:

- Cloudflare Worker API implemented in `src/app.ts`
- D1 schema and repository access patterns
- R2 binding reserved for encrypted object storage
- account bootstrap, login, refresh, sync, folder, cipher, device listing,
  identifier lookup, metadata update, encrypted-key update, device revoke, TOTP,
  backup/restore, audit logging, and compatibility fixtures
- Wrangler environment separation and local CI gates

Out of scope for the initial product:

- Web Vault
- public account registration
- Organizations and shared vaults
- Send
- browser-side cryptography review of third-party clients
- Cloudflare account hardening outside repository-controlled configuration
- bulk trusted-device approval and login-with-device push workflows

## Assets

| Asset                                 | Storage                                | Security Objective                                            |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| account identity and allowlist state  | D1 and Wrangler vars                   | prevent public signup and cross-user access                   |
| master password hash and KDF settings | D1                                     | never log; compare without timing leaks where practical       |
| user key and private key payloads     | D1                                     | store opaque encrypted payloads only                          |
| refresh tokens                        | client plaintext, D1 secret-bound hash | rotate on use; invalidate reuse and revoked devices           |
| access tokens                         | client bearer token                    | verify signature, expiry, subject, device, and security stamp |
| TOTP setup secret                     | D1 AES-GCM envelope                    | wrap with `HONOWARDEN_TOTP_SECRET`; reject replay             |
| vault folders and ciphers             | D1 encrypted payload columns           | preserve ciphertext; enforce owner scope                      |
| R2 vault objects                      | R2                                     | store encrypted objects only; no plaintext server access      |
| audit events                          | platform logs                          | omit secrets and vault payloads                               |
| backup artifacts                      | operator filesystem and target D1/R2   | checksum and restore only into fresh targets                  |
| Worker secrets                        | Cloudflare secrets/local env           | never commit; rotate after suspected exposure                 |

## Actors

- unauthenticated internet client
- authenticated vault user
- malicious authenticated user attempting cross-user access
- compromised device holding access or refresh tokens
- repository contributor or CI actor
- operator with Cloudflare and backup access
- Cloudflare platform operator

## Trust Boundaries

1. Client to Worker HTTP boundary: headers, forms, JSON bodies, route params, and
   bearer tokens are untrusted.
2. Worker to D1/R2 boundary: repository calls must bind user id and avoid SQL
   string interpolation.
3. Worker to platform logs boundary: emitted metadata can still be sensitive.
4. Operator CLI to filesystem/cloud boundary: backup manifests and object lists
   are untrusted inputs until validated.
5. GitHub CI boundary: dependency install, tests, and generated artifacts must
   not require secrets.

## Attack Surface

- public health/config routes: `/`, `/health`, `/healthz`, `/health/db`,
  `/api/config`, `/config`
- account bootstrap route: `/api/accounts/bootstrap`
- disabled public registration routes
- prelogin route: `/identity/accounts/prelogin`
- token route: `/identity/connect/token`
- authenticated sync route: `/api/sync`
- device inventory route: `GET /api/devices`
- device identifier lookup: `GET /api/devices/identifier/:identifier`
- device metadata and encrypted-key update routes
- TOTP setup, setup verify, and disable routes
- device revoke route
- folder and cipher CRUD routes
- operator backup/restore CLI
- audit log stream

## STRIDE Summary

| Threat                 | Current Controls                                                                                                            | Residual Risk                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Spoofing               | HMAC access tokens, refresh-token hashing, device identifiers, security stamp checks, TOTP challenge flow                   | no asymmetric token keys; bulk trusted-device approval is not implemented    |
| Tampering              | D1 owner predicates, revision conflict checks, backup checksum validation                                                   | no live restore drill evidence yet                                           |
| Repudiation            | opt-in audit events for bootstrap, auth failures, refresh reuse, device revoke, revoke-all-other-sessions, and TOTP disable | audit events are not persisted in D1 and do not cover every vault CRUD route |
| Information disclosure | generic auth failures, owner-scoped queries, encrypted vault payload storage, secret-safe audit filtering                   | platform logs/backups remain sensitive operational data                      |
| Denial of service      | password-grant IP and account lockouts, bounded fixture tests                                                               | no global request quota, queue, or abuse monitoring beyond login defenses    |
| Elevation of privilege | public registration disabled, bootstrap default-off, owner-scoped repositories, recent password auth for sensitive actions  | no admin console or full account lifecycle tooling yet                       |

## High-Risk Abuse Paths

1. Credential stuffing against password grant.
   Current mitigation: IP and account failure buckets, generic invalid-grant
   responses, temporary lockout, and audit event hooks.

2. Cross-user vault row access through guessed IDs.
   Current mitigation: repository predicates bind `user_id`, folder ownership is
   checked before cipher create/update, and app tests cover mixed-user sync.

3. Refresh token replay from a compromised device.
   Current mitigation: refresh rotation, revoked-token session invalidation,
   refresh-reuse audit event, and device revoke behavior.

4. Operator backup misuse.
   Current mitigation: dry-run default, path traversal rejection, checksum
   validation, and explicit fresh-target confirmation for restore execution.

5. Secret leakage through logs.
   Current mitigation: audit logging is opt-in, event context filtering removes
   secret-like fields, and docs prohibit request/response body logging.

## Required Follow-Up Before Real Secrets

- run live client smoke tests using synthetic vault data only
- complete a fresh-target backup restore drill
- document Cloudflare account access controls and secret rotation ownership
- decide audit log retention and access rules before enabling logs in production
- run an independent security review before inviting non-operator users
