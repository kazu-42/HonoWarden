# Security Threat Model

Last reviewed: 2026-07-09.

HonoWarden is pre-alpha. This model documents the current implementation and
the controls that must be true before `v0.1.0-alpha` is tagged. It is not an
independent security audit.

## Scope

In scope:

- Cloudflare Worker API implemented in `src/app.ts`
- D1 schema and repository access patterns
- R2 binding for encrypted object storage, including cipher attachment bodies
- account bootstrap, profile mutation, login, refresh, sync, folder, cipher,
  device listing, identifier lookup, metadata update, encrypted-key update,
  device revoke, TOTP, cipher attachments, user backup export, backup/restore,
  audit logging, and compatibility fixtures
- Wrangler environment separation and local CI gates

Out of scope for the initial product:

- Web Vault
- public account registration
- Organizations and shared vaults
- Send and public file-sharing
- Emergency Access
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
| cipher attachment metadata            | D1 `cipher_attachments`                | bind object metadata to owner and cipher lifecycle            |
| R2 vault objects                      | R2                                     | store encrypted objects only; no plaintext server access      |
| user export files                     | client download target                 | recent-auth gate; no server-side raw R2 body export           |
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
- account profile routes: `/api/accounts/profile`
- disabled public registration routes
- prelogin route: `/identity/accounts/prelogin`
- token route: `/identity/connect/token`
- authenticated sync route: `/api/sync`
- user backup export route: `POST /api/accounts/export`
- device inventory route: `GET /api/devices`
- device identifier lookup: `GET /api/devices/identifier/:identifier`
- device metadata and encrypted-key update routes
- TOTP setup, setup verify, and disable routes
- device revoke route
- folder and cipher CRUD routes
- cipher attachment upload, download, and delete routes
- operator backup/restore and account lifecycle CLIs
- audit log stream

Explicitly excluded public sharing surface:

- `/api/sends` and `/api/sends/*` return typed unsupported-feature errors.
- Top-level `/api/attachments` and `/api/attachments/*` return typed
  unsupported-feature errors.
- Public sharing must not be implemented until ADR 0003's expiration,
  revocation, rate-limit, abuse, cache, audit, and retention controls are
  designed and verified.
- `/api/emergency-access` and `/api/emergency-access/*` return typed
  unsupported-feature errors. Emergency Access must not be implemented until ADR
  0004's identity, delay, cancellation, notification, cryptographic handoff,
  abuse, audit, rollback, and incident-response controls are designed and
  verified.

## STRIDE Summary

| Threat                 | Current Controls                                                                                                                                                                                                                       | Residual Risk                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | HMAC access tokens, refresh-token hashing, device identifiers, security stamp checks, TOTP challenge flow                                                                                                                              | no asymmetric token keys; bulk trusted-device approval is not implemented                                                                    |
| Tampering              | D1 owner predicates, attachment metadata predicates, revision conflict checks, backup checksum validation                                                                                                                              | no live restore drill evidence yet                                                                                                           |
| Repudiation            | opt-in D1-persisted audit events for bootstrap, auth failures, refresh reuse, backup export, folder/cipher/attachment mutations, device revoke, revoke-all-other-sessions, TOTP change, and TOTP disable; Worker runtime Logpush to R2 | audit coverage does not yet include unsupported organization/public-sharing surfaces; automated log-retention deletion is still operator-run |
| Information disclosure | generic auth failures, owner-scoped queries, encrypted vault payload storage, recent-auth export gate, secret-safe audit filtering; public sharing routes remain unsupported                                                           | platform logs/backups/user exports remain sensitive operational data                                                                         |
| Denial of service      | password-grant IP and account lockouts, bounded fixture tests; public sharing routes remain unsupported                                                                                                                                | no global request quota, queue, export-specific throttle, public-link abuse dashboard, or Send-specific rate limit                           |
| Elevation of privilege | public registration disabled, bootstrap default-off, owner-scoped repositories, recent password auth for sensitive actions, dry-run-first account lifecycle CLI; Emergency Access remains unsupported                                  | no admin console, delegated recovery security model, or live production lifecycle evidence yet                                               |

## High-Risk Abuse Paths

1. Credential stuffing against password grant.
   Current mitigation: IP and account failure buckets, generic invalid-grant
   responses, temporary lockout, and audit event hooks.

2. Cross-user vault row access through guessed IDs.
   Current mitigation: repository predicates bind `user_id`, folder ownership is
   checked before cipher create/update, attachment lookups bind user and cipher
   IDs, and app tests cover mixed-user sync.

3. Refresh token replay from a compromised device.
   Current mitigation: refresh rotation, revoked-token session invalidation,
   refresh-reuse audit event, and device revoke behavior.

4. Operator backup misuse.
   Current mitigation: dry-run default, path traversal rejection, checksum
   validation, and explicit fresh-target confirmation for restore execution.

5. User export misuse from a compromised authenticated session.
   Current mitigation: export requires recent password-auth access tokens,
   owner-scoped repository reads, `Cache-Control: no-store`, and no raw R2
   object body or internal object-key disclosure.

6. Secret leakage through logs.
   Current mitigation: audit logging is opt-in, event context filtering removes
   secret-like fields, D1 persistence uses explicit metadata columns plus
   sanitized context, and docs prohibit request/response body logging.

7. Public-link abuse or unauthorized sharing.
   Current mitigation: Send and top-level public attachment routes remain
   unsupported. ADR 0003 requires access-token entropy, expiration, revocation,
   rate limits, abuse reporting, cache policy, encrypted/opaque object handling,
   and retention/deletion design before implementation.

8. Delegated recovery privilege escalation.
   Current mitigation: Emergency Access routes remain unsupported. ADR 0004
   requires grantee identity, invitation, delay, cancellation, timeout,
   notification, cryptographic handoff, audit, abuse, rollback, and incident
   response design before implementation.

## Required Follow-Up Before Real Secrets

- run live client smoke tests using synthetic vault data only
- complete a fresh-target backup restore drill
- document Cloudflare account access controls and secret rotation ownership
- apply and verify audit-event migration `0007` before enabling audit logging in
  staging or production
- keep external Cloudflare log retention and access evidence fresh before
  relying on platform logs for incident response
- run an independent security review before inviting non-operator users
