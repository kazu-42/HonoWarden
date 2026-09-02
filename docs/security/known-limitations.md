# Security Known Limitations

Last reviewed: 2026-08-09.

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
- Organizations are an active team-vault product line under ADR 0010, which
  supersedes ADR 0005's non-goal for the merged slices. The organization
  foundation provides authenticated create/get and confirmed-member
  sync/profile projection. Owner-administered organization collection CRUD is
  also implemented. Membership and role lifecycle, invitations, organization
  cipher sharing and assignment, policy enforcement, complete cross-user
  isolation evidence, organization audit coverage, and broad official-client
  compatibility remain incomplete.
- Organization policy management and enforcement are intentionally not
  implemented; ADR 0006 keeps policy metadata reads empty for personal vaults
  until policy schema, enforcement points, audit, rollback, and compatibility
  fixtures are designed.
- ADR 0010 supersedes ADR 0007's empty collection boundary for confirmed-member
  organization reads and owner-administered organization collection CRUD.
  Non-owner membership selection, organization cipher assignment, collection
  audit events, and broad official-client compatibility remain unimplemented or
  unverified.
- Hosted billing, commercial licensing, provider/reseller portals,
  sponsorships, and multi-tenant hosted operation are rejected under
  [ADR 0013](../adr/0013-hosted-billing-licensing-tenancy.md). The Android
  startup read `GET /api/account/billing/vnext/subscription` returns a
  zero-cost canceled cart; that placeholder does not imply a paid subscription,
  entitlement, or hosted support contract. Remaining billing, license, plan,
  provider, sponsorship, and invoice routes return state-free `501`
  `unsupported_feature` responses.
- Premium-gated surfaces outside TOTP and cipher-scoped attachments are
  intentionally unavailable under ADR 0009. Emergency Access requires ADR
  0004's original design gates; ADR 0013 now accepts and specifies the future
  product line, including grantee identity, delayed access, cancellation,
  notification, cryptographic handoff, audit, abuse-control, and rollback, but
  no stateful Emergency Access source or runtime support is implemented by that
  design slice. Server-origin
  vault breach lookup at `GET /api/hibp/breach` is unsupported; the pinned
  extension performs weak/reused-password evaluation locally and calls the
  external Pwned Passwords range API directly for its manual exposed-password
  check. ADR 0011 accepts and specifies a future Send product line, including
  public access-token entropy, but no stateful Send source or runtime support is
  implemented by that design slice.
  File Sends and all other Send/public-sharing operations remain behind the
  existing `501` guards, with `send-enabled: false`, until the text, file,
  public-control, abuse, cleanup, activation, rollback, and live-evidence slices
  pass.
- Unsupported Emergency Access, breach-lookup, and Send routes return state-free
  HTTP `501` responses with `error.code = unsupported_feature` and a top-level
  `Message` that official clients can render. This includes the `send_access`
  grant at `POST /identity/connect/token`; password, refresh-token, and
  login-with-device grants keep their supported behavior. The pinned client's
  Emergency Access trust preflight consequently blocks account-key rotation,
  and its attachment action may also report the rejected request through its
  global error handler after clearing loading state; returning `404` instead
  would activate a misleading cached attachment URL fallback.
- Cipher-scoped attachment upload, download, delete, and sync metadata are
  implemented for opaque client-encrypted payloads. HON-124 records a synthetic
  staging allocation, upload, download, and delete run with official Desktop
  `2026.6.1` plus clean teardown. That narrow issue-local evidence does not
  promote the Desktop matrix row or prove browser, mobile, production, or broad
  regression behavior.
- User-triggered server-side export is implemented at
  `POST /api/accounts/export` behind recent password authentication, but no
  live official-client export run has been captured yet.
- read-only device list endpoints (`GET /api/devices`, `GET /api/devices/identifier/:identifier`), anonymous preflight (`GET /api/devices/knowndevice`), device metadata mutation, device encrypted-key update routes, and bulk trusted-device rotation (`POST /api/devices/update-trust`) are implemented. Login-with-device request, approval, owner notification, anonymous requester notification, and one-time token exchange are live-tested with synthetic data in staging. Repeated resend atomically supersedes the previous owner/device pending request, and a partial unique index prevents two approvable requests. Production remains disabled, and the current official extension still relies on response notification rather than automatic timed polling.
- account lifecycle operator CLI is dry-run-first and read-only; recovery and
  purge require the private `AccountLifecycleOperator` service-binding RPC, but
  no admin UI or live production lifecycle evidence is recorded yet. Anonymous
  deletion-token source tests prove equal HTTP status and explicit mailer
  `deliver`/`suppress` dispositions; they do not prove deployed mailer latency,
  provider suppression, or request-body logging controls.
- current-password verification and existing master-password change are covered
  by compatibility fixtures and a synthetic local Wrangler/D1 lifecycle. No
  official client password-change UI or production password-change run is
  recorded. Official-client readback exists only where the canonical credential
  registry identifies it, and it proves post-mutation login, unlock, sync, and
  item readback rather than an in-client password-change surface. Non-empty
  password hints are rejected because hint persistence is not implemented. The
  writer is default-off in every tracked environment; HON-226 proves only local
  same-target disable-state equality and one forward official-CLI generation,
  not deployment activation or browser-extension recovery.
- existing-account PBKDF2/Argon2id KDF change is covered by focused tests and a
  synthetic local Wrangler/D1 lifecycle. No official client settings UI or
  production KDF-change run is recorded. Official-client readback, where
  recorded in the canonical registry, proves that the resulting generation is
  readable after an API-driven local mutation; it does not claim a client
  settings flow. The irreversible writer remains default-off in every tracked
  environment until a reader-capable rollback target is deployed.
  Unknown-account prelogin decoys match the current client-readable stored KDF
  population by account count but are not a proof of cryptographic
  indistinguishability; the email allowlist remains the primary boundary.
  Unrelated invalid rows are excluded from that population while an invalid exact
  target fails closed. Reversibly disabled accounts retain their KDF projection
  and population weight so the anonymous endpoint does not expose disable/enable
  transitions; disabled authentication and sessions remain rejected. Each
  allowed prelogin reads the materialized distinct KDF tuples rather than
  grouping all users. The tuple set can still grow with account-specific KDF
  configurations and requires cardinality and latency monitoring before broader
  exposure. Migration triggers abort a user insert/delete/KDF update if the old
  tuple count is missing instead of allowing silent population drift.
- authenticated account-key read and one-time V1 initialization are covered by
  pinned route fixtures, focused tests, and a synthetic local Wrangler/D1
  lifecycle. No official client account-key UI, staging, production, or
  real-account run is recorded. Official-client readback, where recorded in the
  canonical registry, proves decrypt readback after local initialization rather
  than an in-client account-key management surface, and every tracked
  environment keeps the route flag false. The
  initializer accepts only both-null state, preserves the security stamp and
  existing sessions, and cannot repair or replace a partial/different pair.
  True replacement, client data rewrap, V2 signature keys, signed public keys,
  security state, TDE, and Key Connector remain unsupported pending HON-206 or
  later reviewed work.
- The dedicated
  [`HonoWarden-inquiry-inbox`](https://github.com/kazu-42/HonoWarden-inquiry-inbox)
  service implements metadata-only inbound ingestion, redaction-first AI
  triage, human-reviewed drafts, duplicate-safe Linear issue creation, an
  Access-protected operator queue/API, and approval-gated outbound delivery.
  HON-99 records one human-approved staging reply with exactly-once state/audit
  readback, while HON-129 records Resend staging/production deployment and a
  direct provider `Sent -> Delivered` result. Raw MIME and attachments remain
  unretained, autonomous send/Linear writes remain disabled, and synthetic
  evidence does not prove handling of a real vulnerability report.

## Credential Closeout Boundary

The canonical credential and recovery evidence is the
[closeout packet](../../compat/credential-closeout-packet.json) bound to the
[evidence registry](../../compat/credential-evidence.json). Per-operation
evidence documents remain supporting detail; the packet and registry define the
claim ceiling.

| Evidence level          | Claims |
| ----------------------- | -----: |
| `fixture`               |      0 |
| `local_api`             |      4 |
| `local_official_client` |      7 |
| `staging`               |      0 |
| `production`            |      0 |

Packet limitations:

- The registry verifies committed metadata and artifact markers; it does not rerun the recorded local lifecycle.
- No claim in this registry proves staging or production activation.

The `local_official_client` rows are official-client readback evidence after
isolated local API operations. They are not official-client UI claims, are not
staging evidence, and are not production evidence.

## Security Control Gaps

- Required credential-generation events are persisted atomically in D1, and
  optional route events can be persisted in D1 `audit_events` when audit logging
  is enabled. Persistence fails loudly and bounded 365-day retention is
  implemented, but every tracked environment remains default-off until an
  approved target enablement and readback.
- Secret-safe audit coverage includes personal folder, cipher, and attachment
  mutations. Organization creation and collection mutations are not yet audited;
  the audit event and target contracts do not currently include organization or
  collection events.
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

- 2026-07-14: A broad Wrangler OAuth session on an operator machine can silently
  satisfy Wrangler commands when environment credentials are absent. A
  successful Wrangler command alone cannot prove scoped-only operation. The
  preflight detects default and named auth-profile filenames without opening or
  modifying profile contents. An operator seeking scoped-only proof must run
  `wrangler logout` for the default profile first, deactivate and delete any
  remaining named profile, and then provide only the intended scoped token.
  Repository scripts do not mutate that operator-owned session.
- Production usage remains blocked by pre-alpha safety limits, unsupported
  surfaces, and lack of real-data dogfood evidence.
- D1 audit-event persistence has a 365-day retention policy, but staging and
  production audit logging remain disabled by default until operator access and
  target enablement are explicitly approved and read back.
- External Worker runtime logs now ship to a dedicated Cloudflare R2 Logpush
  sink with operator-only access, but downstream SIEM/vendor alerting and
  automated retention deletion are still operator-run rather than productized.
- Backup directories and manifests now have a documented short-retention
  encrypted GitHub artifact policy and a 35-day operator archive target, but
  long-term archive storage is still operator-owned rather than automated in
  the repository.
- `security@honowarden.com` inbound routing and public metadata are smoke-tested.
  The dedicated inquiry service has a deployed operator queue, redaction-first
  triage, approval-gated reply, and duplicate-safe Linear workflow with
  HON-99/HON-129 synthetic delivery evidence. Real vulnerability-report
  handling is not externally assessed, and raw body or attachment retention
  remains disabled pending a separately approved retention and access design.
