# Security Threat Model

Last reviewed: 2026-08-08.

HonoWarden is pre-alpha. This model documents the current implementation and
the controls that remain load-bearing after the published `v0.1.0-alpha`
prerelease. It is not an independent security audit or real-secret readiness
approval.

## Scope

In scope:

- Cloudflare Worker API implemented in `src/app.ts`
- D1 schema and repository access patterns
- R2 binding for encrypted object storage, including cipher attachment bodies
- account bootstrap, profile mutation, account-key initialization, login,
  refresh, sync, folder, cipher, device listing, identifier lookup, metadata
  update, encrypted-key update, device revoke, TOTP, cipher attachments, user
  backup export, backup/restore, login-with-device, the ADR 0010 organization
  foundation and owner-administered organization collection CRUD, audit logging,
  and compatibility fixtures
- Wrangler environment separation and local CI gates

Out of scope for the initial product:

- Web Vault
- public account registration
- organization membership mutation, invitations, role administration,
  organization cipher sharing/assignment, and policy enforcement beyond the
  ADR 0010 organization foundation and collection CRUD slices
- Send and public file-sharing runtime activation; ADR 0011 is an accepted
  future design contract, not implemented capability
- Emergency Access runtime activation; ADR 0013 is an accepted future design
  contract, not implemented capability
- browser-side cryptography review of third-party clients
- Cloudflare account hardening outside repository-controlled configuration
- production login-with-device activation; source and synthetic staging flows
  are verified while production remains default-off

## Assets

| Asset                                 | Storage                                | Security Objective                                              |
| ------------------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| account identity and allowlist state  | D1 and Wrangler vars                   | prevent public signup and cross-user access                     |
| master password hash and KDF settings | D1                                     | never log; compare without timing leaks where practical         |
| wrapped user key                      | D1                                     | store opaque encrypted payload only                             |
| account public/wrapped-private pair   | D1                                     | owner scope; initialize once; never log either value            |
| refresh tokens                        | client plaintext, D1 secret-bound hash | rotate on use; invalidate reuse and revoked devices             |
| login-with-device access codes        | client plaintext, D1 keyed hash        | never recover or log; bind to one request and one consumption   |
| auth-request encrypted handoff        | D1 opaque ciphertext                   | owner/device scope; never decrypt or place in notifications     |
| access tokens                         | client bearer token                    | verify signature, expiry, subject, device, and security stamp   |
| TOTP setup secret                     | D1 AES-GCM envelope                    | wrap with `HONOWARDEN_TOTP_SECRET`; reject replay               |
| vault folders and ciphers             | D1 encrypted payload columns           | preserve ciphertext; enforce owner scope                        |
| cipher attachment metadata            | D1 `cipher_attachments`                | bind object metadata to owner and cipher lifecycle              |
| R2 vault objects                      | R2                                     | store encrypted objects only; no plaintext server access        |
| user export files                     | client download target                 | recent-auth gate; no server-side raw R2 body export             |
| audit events                          | D1 `audit_events` and platform logs    | filter secrets; fail loud when enabled; retain D1 rows 365 days |
| backup artifacts                      | operator filesystem and target D1/R2   | checksum and restore only into fresh targets                    |
| Worker secrets                        | Cloudflare secrets/local env           | never commit; rotate after suspected exposure                   |

Secret-safe D1 audit coverage includes personal folder, cipher, and attachment
mutations. Organization creation and collection mutations are not yet audited;
the current audit event and target contracts have no organization or collection
variant.

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
- default-off credential writers: `POST /api/accounts/password`,
  `POST /api/accounts/kdf`, `GET` and `POST /api/accounts/keys`, and
  `POST /api/accounts/key-management/rotate-user-account-keys`
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
- authenticated organization create/get and confirmed-member sync/profile
  projection
- confirmed-member organization collection reads and owner-administered
  organization collection CRUD
- operator backup/restore and account lifecycle CLIs
- audit log stream
- login-with-device request, approval, notification, polling, supersession, and
  one-time token exchange surfaces; staging is enabled and production is
  default-off

Explicitly bounded sharing and organization surfaces:

- ADR 0005's organization non-goal is superseded by ADR 0010. The organization
  foundation and owner-administered collection CRUD are implemented;
  membership mutation, invitations, role changes, non-owner access selection,
  organization cipher sharing/assignment, and remaining routes stay typed
  unsupported until their bounded slices pass cross-user isolation, audit,
  migration, rollback, and compatibility gates.
- Policy metadata reads return authenticated empty list responses for personal
  vaults. Policy mutation or organization policy enforcement must not be
  implemented until ADR 0006's schema, enforcement-point, default-behavior,
  audit, rollback, and compatibility controls are designed and verified.
- Confirmed-member collection reads and owner-administered organization
  collection CRUD are implemented under ADR 0010. Organization cipher
  assignment, non-owner membership selection, and collection audit events
  remain unsupported or unverified. ADR 0007 is the superseded historical empty
  collection boundary rather than the current source claim.
- `/api/sends` and `/api/sends/*` return typed `501` unsupported-feature errors.
- Top-level `/api/attachments` and `/api/attachments/*` return typed
  unsupported-feature errors.
- ADR 0003 required a replacement design before public sharing could be
  reconsidered. ADR 0011 supplies that design and the dedicated
  `send-public-sharing-threat-model.md` / `send-wire-contract.md`, but runtime
  implementation remains prohibited until its text, file, public-control,
  abuse, cleanup, activation, rollback, and live-evidence gates are verified.
- `/api/emergency-access` and `/api/emergency-access/*` return typed
  unsupported-feature errors. ADR 0004 required a replacement design before
  delegated recovery could be reconsidered. ADR 0013 supplies that design and
  the dedicated `emergency-access-threat-model.md` /
  `emergency-access-wire-contract.md`, but runtime implementation remains
  prohibited until its identity, wait/approval, cryptographic, abuse, audit,
  activation, rollback, and live-evidence gates are verified. Routes remain
  explicit `501`.

## STRIDE Summary

| Threat                 | Current Controls                                                                                                                                                                                                                                          | Residual Risk                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | HMAC access tokens, refresh-token hashing, device identifiers, security stamp checks, TOTP challenge flow                                                                                                                                                 | no asymmetric token keys; bulk trusted-device approval is not implemented                                                                         |
| Tampering              | D1 owner predicates, account-key wrapped-user-key/both-null/stamp/revision guard plus required audit, attachment metadata predicates, revision conflict checks, backup checksum validation; organization collection mutations require the confirmed owner | account-key replacement and partial-state repair are intentionally unavailable; organization policy mutation remains unsupported                  |
| Repudiation            | opt-in D1-persisted audit events for bootstrap, auth failures, refresh reuse, backup export, personal folder/cipher/attachment mutations, device revoke, revoke-all-other-sessions, TOTP change, and TOTP disable; Worker runtime Logpush to R2           | organization creation and collection mutations lack audit events; automated log-retention deletion is still operator-run                          |
| Information disclosure | generic auth failures, owner-scoped queries, confirmed-member organization reads, complete-only account-key projection, encrypted vault payload storage, recent-auth export gate, and secret-safe audit filtering                                         | platform logs/backups/user exports remain sensitive operational data; organization membership/cipher sharing and public sharing are unsupported   |
| Denial of service      | password-grant IP and account lockouts, bounded fixture tests; unimplemented organization membership/cipher sharing and public sharing routes fail explicitly                                                                                             | no global request quota, queue, export-specific throttle, public-link abuse dashboard, or Send-specific rate limit                                |
| Elevation of privilege | public registration disabled, bootstrap default-off, owner-scoped repositories, confirmed-owner collection mutations, recent password auth for sensitive actions, dry-run-first account lifecycle CLI                                                     | organization membership/roles/cipher assignment/policies, admin console, delegated recovery, and live production lifecycle evidence remain absent |

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

7. Shared vault privilege escalation.
   Current mitigation: ADR 0010's organization foundation limits create/get and
   sync/profile projection to authenticated confirmed members. Collection CRUD
   mutations require the confirmed owner and use existence-obscuring failures.
   Membership/role mutation, organization cipher sharing/assignment, policy
   enforcement, and broad compatibility remain typed unsupported until their
   own cross-user isolation and audit gates pass.

8. Policy bypass through unenforced organization rules.
   Current mitigation: policy metadata reads are empty personal-vault metadata
   only; policy mutation and organization enforcement are unsupported. ADR 0006
   requires schema, enforcement points, default behavior, audit, rollback, and
   compatibility fixture design before implementation.

9. Collection assignment privilege escalation.
   Current mitigation: confirmed members see only accessible organization
   collections, while create/update/delete and access-detail routes require the
   confirmed owner. Non-owner membership selection and organization cipher
   assignment remain unsupported, and collection mutations are not yet audited.

10. Public-link abuse or unauthorized sharing.
    Current mitigation: Send and top-level public attachment routes remain
    explicit `501` responses and config remains disabled. ADR 0003 required the
    replacement design now accepted as ADR 0011; the dedicated Send threat model
    defines capability entropy, token, concurrency, D1/R2, rate-limit, abuse,
    cache, audit, retention, activation, and rollback gates that still require
    implementation and evidence.

11. Delegated recovery privilege escalation.
    Current mitigation: Emergency Access routes remain unsupported `501`
    responses. ADR 0004 required the replacement design now accepted as
    ADR 0013; the dedicated Emergency Access threat model defines identity
    proof, confirmation, wait/approval, key generation, notification
    non-authority, audit, abuse, activation, and rollback gates that still
    require implementation and evidence.

12. Login-with-device confused-deputy or replay attack.
    Current mitigation: ADR 0008's request, approval, notification, and one-time
    token exchange are implemented and synthetic-live-tested in staging. A
    different active approving device, owner-scoped compare-and-set transitions,
    keyed access-code hashes, fixed expiry, atomic consumption, metadata-only
    audit, quotas, and request supersession constrain the flow. Production
    remains default-off, and official-extension timed polling is not yet proven.

13. Account-key overwrite or partial-key disclosure.
    Current mitigation: dedicated routes are default-off and owner-authenticated;
    initialization requires a non-empty wrapped user key and the exact active
    both-null stamp/revision generation, persists a required redacted audit in
    the same D1 batch, treats exact replay as a no-op, rejects replacement/V2
    input, constrains bootstrap to missing-or-complete key envelopes, bypasses
    quota D1 work while disabled, and uses complete-only projections before
    touched token-session, profile, or backup success side effects. Invalid
    projections emit a redacted request-correlated incident signal, and backup
    failure audit preserves its bounded corruption reason.

## Required Follow-Up Before Real Secrets

- run live client smoke tests using synthetic vault data only
- complete a fresh-target backup restore drill
- document Cloudflare account access controls and secret rotation ownership
- read back audit-event migration `0007` in the target environment and explicitly
  approve the default-off audit writer before enabling it in staging or production
- add and verify audit coverage for organization creation and collection
  mutations before treating organization administration as operationally complete
- keep external Cloudflare log retention and access evidence fresh before
  relying on platform logs for incident response
- run an independent security review before inviting non-operator users
