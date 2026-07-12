# Security Known Limitations

Last reviewed: 2026-07-12.

HonoWarden remains pre-alpha. These limitations are release and operations
inputs, not minor documentation notes.

## Release Blockers Before Real Secrets

- no independent security audit has been completed
- narrow live smokes exist for the CLI, browser extension, Android, and
  Desktop clients; no full live client regression suite exists yet
- remote production backup and local fresh-target restore drill evidence exists,
  but no remote disposable Cloudflare restore drill has been recorded
- Cloudflare scoped account tokens exist for normal HonoWarden operations, but
  account-level two-factor enforcement, broad Super Administrator access,
  legacy no-expiry tokens, and global-key break-glass rotation remain operator
  hardening work
- incident response runbook and tabletop evidence exist, and formal secret
  rotation dry-run evidence exists, but no live incident, real secret rotation,
  or external communications drill has been executed

## Current Product Gaps

- Web Vault is intentionally not implemented; HonoWarden has no
  browser-delivered vault UI, browser session boundary, or static app asset
  supply chain in the alpha scope.
- Public registration is disabled.
- Organizations and shared vaults are intentionally not implemented; ADR 0005
  keeps them out of the alpha personal-vault product line unless membership,
  ownership, role, collection-access, cross-user isolation, encrypted key
  sharing, audit, migration, and rollback design is completed first.
- Organization policy management and enforcement are intentionally not
  implemented; ADR 0006 keeps policy metadata reads empty for personal vaults
  until policy schema, enforcement points, audit, rollback, and compatibility
  fixtures are designed.
- Collection mutation and assignment are intentionally not implemented; ADR
  0007 keeps collection metadata read-only and empty for personal vaults until
  ownership, membership, assignment, audit, migration, rollback, and
  compatibility fixtures are designed.
- Send and public file-sharing are intentionally not implemented; ADR 0003
  requires public access-token entropy, expiration, revocation, rate limits,
  abuse reporting, cache policy, audit, and retention/deletion design before
  any public sharing support claim.
- Emergency Access is intentionally not implemented; ADR 0004 requires grantee
  identity, delayed access, cancellation, notification delivery, cryptographic
  handoff, transition audit, abuse controls, rollback, and incident-response
  design before any delegated recovery support claim.
- Cipher-scoped attachment upload, download, delete, and sync metadata are
  implemented for opaque client-encrypted payloads, but no live official-client
  attachment run has been captured yet.
- User-triggered server-side export is implemented at
  `POST /api/accounts/export` behind recent password authentication, but no
  live official-client export run has been captured yet.
- read-only device list endpoints (`GET /api/devices`, `GET /api/devices/identifier/:identifier`), anonymous preflight (`GET /api/devices/knowndevice`), device metadata mutation, device encrypted-key update routes, and bulk trusted-device rotation (`POST /api/devices/update-trust`) are implemented. Login-with-device request, approval, owner notification, anonymous requester notification, and one-time token exchange are live-tested with synthetic data in staging. Production remains disabled, the current official extension relies on response notification rather than automatic timed polling, and repeated resend attempts can leave older pending requests visible until fixed expiry.
- account disable/enable operator CLI is dry-run-first, but no admin UI or live
  production lifecycle evidence is recorded yet.
- AI inquiry inbox architecture is documented and metadata-only inbound Worker
  ingestion is implemented, but the mailbox UI, email body or attachment
  storage, AI triage, approved outbound replies, and Linear issue creation
  automation are not implemented yet.

## Security Control Gaps

- Audit events are platform log lines only; they are not persisted with retention
  controls in D1.
- Audit event coverage does not include every vault CRUD route.
- Operator backup/restore evidence now includes a scheduled GitHub Actions
  workflow, remote D1/R2 backup evidence, and a local fresh-target restore
  drill with a synthetic R2 object.
- The scheduled remote backup workflow has not yet produced its first
  post-merge cron artifact; until then, manual remote evidence remains the
  current proof.
- TOTP wrapping-secret rotation tooling exists, but no live rotation or
  force-re-enrollment drill has been run.
- Access tokens still use symmetric HMAC keys. Key id based staged rotation is
  implemented, but no formal live access-token key rotation drill has been run.
- The formal secret rotation drill is dry-run-only and must not be treated as
  live credential rotation, account 2FA enforcement, stale-token retirement, or
  external communications readiness.
- Password-grant login defense is always available. The global request quota is opt-in
  through `HONOWARDEN_GLOBAL_REQUEST_QUOTA` and stores hashed
  `request_quota_buckets`, but it has not been enabled in production yet.
- `pnpm abuse:report` emits a secret-safe operator alert packet for request
  quota pressure, auth-failure locks, cleanup backlog, and scheduled cleanup
  failures, but no external abuse notification sink or dashboard is configured.

## Testing Gaps

- Compatibility rows remain `fixture_only` unless linked live evidence exists.
- Test support models selected D1 query shapes, not full SQLite behavior.
- Security docs are CI-checked for presence and key content, but not formally
  reviewed by an external auditor.

## Operational Gaps

- Production usage remains blocked by pre-alpha safety limits, unsupported
  surfaces, and lack of real-data dogfood evidence.
- D1 audit-event persistence has a 365-day retention policy, but staging and
  production audit logging remain disabled by default until `0007` is migrated
  and operator access is explicitly approved.
- External Worker runtime logs now ship to a dedicated Cloudflare R2 Logpush
  sink with operator-only access, but downstream SIEM/vendor alerting and
  automated retention deletion are still operator-run rather than productized.
- Backup directories and manifests now have a documented short-retention
  encrypted GitHub artifact policy and a 35-day operator archive target, but
  long-term archive storage is still operator-owned rather than automated in
  the repository.
- `security@honowarden.com` inbound routing and public metadata are
  smoke-tested, and metadata-only inquiry inbox retention/redaction tables
  exist. Real vulnerability-report handling still needs mailbox UI, triage,
  and outbound reply controls.
