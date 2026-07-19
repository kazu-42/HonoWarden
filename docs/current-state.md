# Current State

Last updated: 2026-07-19

## Week 1 Status

HonoWarden is a deployable Cloudflare Workers API shell.

Implemented:

- Hono + TypeScript strict project
- Wrangler configuration for local, staging, and production environments
- D1 and R2 binding placeholders
- generated Cloudflare runtime types
- GitHub Actions CI
- Dependabot configuration
- Vitest route tests
- `GET /`
- `GET /health`
- `GET /healthz`
- `GET /api/config`
- structured JSON 404 responses
- request ID propagation
- CORS for same-origin and extension-style origins
- basic security headers

## Week 2 Increment

Implemented:

- initial D1 migration for users, devices, refresh tokens, folders, and ciphers
- schema migration ledger
- indexes for normalized user lookup, session lookup, revision scans, and deleted cipher scans
- encrypted payload columns for vault records, with no plaintext vault fields in the schema
- `GET /health/db` for D1 availability, schema version, and required-table checks
- unit tests for migration shape, database health states, and the HTTP health route

## Week 3 Increment

Implemented:

- executable compatibility fixture directory under `compat/fixtures`
- fixture examples for prelogin KDF discovery, password grant token success, and empty vault sync
- `pnpm compat:test`
- CI coverage for compatibility fixtures

## Week 4 Increment

Implemented:

- `POST /identity/accounts/prelogin`
- email normalization and `HONOWARDEN_ALLOWED_EMAILS` allowlist parsing
- default-deny prelogin behavior
- explicit `403` responses for public registration endpoints
- regenerated Cloudflare binding types for the allowlist variable

## Week 5 Increment

Implemented:

- private `POST /api/accounts/bootstrap` operator endpoint
- default-off bootstrap flag
- bootstrap token check via request header
- allowlisted account creation using normalized email
- D1 `INSERT OR IGNORE` account creation to handle duplicate parallel bootstrap attempts
- stable `201`, `400`, `403`, `409`, and `503` bootstrap responses

## Week 6 Increment

Implemented:

- `POST /identity/connect/token` password grant
- `HONOWARDEN_TOKEN_SECRET` fail-closed token signing requirement
- normalized user lookup for password grant
- constant-time comparison for presented master password hash
- HMAC-signed access tokens
- random refresh token generation with secret-bound SHA-256 hash storage
- generation-guarded device/session upsert before refresh token persistence
- stable invalid grant, invalid request, misconfigured, and database unavailable responses

## Week 7 Increment

Implemented:

- `refresh_token` grant support on `POST /identity/connect/token`
- refresh token lookup by secret-bound hash
- atomic refresh token rotation with generation-guarded child insertion,
  old-token revocation, and active-device update in one D1 batch
- session invalidation when a revoked token is presented again
- invalid grant handling for unknown, expired, disabled-user, and revoked-device refresh tokens
- refresh grant compatibility fixture

## Week 8 Increment

Implemented:

- access-token verification for signed compact tokens
- user lookup by ID for authenticated API reads
- authenticated `GET /api/sync`
- fail-closed `503` response when token signing is not configured
- stable `401` responses for missing, invalid, expired, disabled-user, and security-stamp-mismatch sync requests
- empty personal vault sync response with profile metadata and empty folders, collections, ciphers, domains, policies, and sends
- HTTP tests for successful empty sync and auth failure cases

## Week 9 Increment

Implemented:

- owner-scoped folder repository for list, create, update, and soft delete
- shared protected-route authentication helper for sync and folder routes
- `POST /api/folders`
- `PUT /api/folders/:id`
- `DELETE /api/folders/:id`
- folder inclusion in `GET /api/sync`
- stable `400`, `401`, `404`, and `503` folder-route responses
- HTTP tests for folder create, update, delete, invalid body, not found, and sync-with-folders

## Week 10 Increment

Implemented:

- owner-scoped cipher repository for active list and create
- active folder ownership check for cipher create
- `POST /api/ciphers` for login item creation
- cipher inclusion in `GET /api/sync`
- opaque encrypted JSON persistence in `ciphers.encrypted_json`
- response merging that keeps stored server metadata authoritative over request payload fields
- stable `400`, `401`, `404`, and `503` cipher-create responses
- HTTP tests for cipher create, sync-with-ciphers, invalid body, and missing folder

## Week 11 Increment

Implemented:

- owner-scoped cipher update repository operation
- owner-scoped cipher trash, restore, and permanent delete repository operations
- `PUT /api/ciphers/:id` updates a cipher
- `PUT /api/ciphers/:id/delete` trashes a cipher
- `DELETE /api/ciphers/:id` permanently deletes a cipher
- `POST /api/ciphers/:id/delete` is the upstream permanent-delete alias
- `PUT /api/ciphers/:id/restore` restores a trashed cipher
- `DELETE /api/ciphers/:id/delete` remains a permanent-delete alias
- folder ownership check for cipher update
- stable `400`, `401`, `404`, and `503` cipher lifecycle responses
- HTTP tests for cipher update, trash, restore, permanent delete, invalid body, missing folder, and not found

## Week 12 Increment

Implemented:

- secure-note cipher type support for create and update request validation
- unknown encrypted payload field preservation in cipher create responses
- unknown encrypted payload field preservation in cipher update responses
- 50 active cipher sync coverage
- favorite flag preservation across sync
- tests that server-owned cipher metadata stays authoritative over request payload metadata
- round-trip tests for future encrypted payload shapes without schema changes

## Week 13 Increment

Implemented:

- required caller-observed `revisionDate` on folder update requests
- required caller-observed `revisionDate` on cipher update requests
- owner-scoped folder update guard using the active row revision
- owner-scoped cipher update guard using the active row revision
- `409 revision_conflict` responses for stale folder and cipher updates
- preserved `404` behavior for missing, deleted, and cross-user update targets
- repository tests for matching, stale, and missing-row update outcomes
- HTTP tests for missing revision and stale revision update cases

## Week 14 Increment

Implemented:

- owner-scoped active device revoke repository operation
- active refresh token cleanup when a device is revoked
- authenticated `POST /api/devices/:id/revoke`
- current-device self-revoke rejection using the access token device claim
- stable `400`, `404`, and `503` device-revoke route responses
- refresh grant rejection coverage for revoked devices
- repository and HTTP tests for successful revoke, missing target, and self-revoke behavior

## Week 15 Increment

Implemented:

- structured client compatibility matrix under `compat/client-matrix.json`
- human-readable compatibility matrix under `docs/compatibility-matrix.md`
- exact tracked versions for browser extension, desktop, mobile Android, mobile iOS, and CLI surfaces
- mobile build number tracking for Android and iOS rows
- metadata refresh cadence/source refs under `compat/client-matrix.json`
- documented release metadata refresh procedure and stale threshold in
  `docs/compatibility-matrix.md`
- conservative `fixture_only` verification level for all rows at matrix creation
- explicit known issues per client surface
- explicit Web Vault exclusion and API-only compatibility boundary in ADR and
  compatibility docs
- explicit Organizations/shared-vault exclusion and future membership, role,
  collection-access, cross-user isolation, migration, and rollback gates in ADR
  0005, threat model, and compatibility docs
- explicit policy management/enforcement exclusion and personal-vault empty
  policy metadata default in ADR 0006, threat model, and compatibility docs
- explicit collection mutation/assignment exclusion and personal-vault
  read-only empty collection metadata default in ADR 0007, threat model, and
  compatibility docs
- explicit Send/public-sharing exclusion and future design gates in ADR 0003,
  threat model, and compatibility docs
- explicit Emergency Access exclusion and future delegated-recovery design gates
  in ADR 0004, threat model, and compatibility docs
- compatibility matrix validation in `pnpm compat:test`
- repeatable live regression packet generator in
  `scripts/honowarden-live-regression-packet.mjs` and release runbook in
  `docs/release/live-regression-matrix.md`

Not implemented:

- refresh token reuse alerting
- live client compatibility evidence for the tracked versions
- actual `live_regression` matrix promotion for any tracked client row
- automated network fetch of upstream release metadata in CI
- any storage of real password-vault data

## Week 16 Increment

Implemented:

- runtime environment resolution for `development`, `staging`, and `production`
- `GET /health` and `GET /healthz` environment visibility for operational checks
- fail-closed fallback to `development` for missing or unknown environment values
- CI-covered Wrangler environment separation checks for staging and production worker names, D1 database names, R2 bucket names, and bootstrap defaults
- staging-first dogfood runbook with low-risk synthetic-data policy, promotion gates, abort conditions, and future evidence format
- Week 16 dynamic workflow artifacts

Not implemented:

- live one-week dogfood evidence
- Cloudflare resource creation for real staging or production D1/R2 IDs
- production deploy, production secrets, or real client-account setup
- promotion of compatibility matrix rows beyond `fixture_only`

## Week 17 Increment

Implemented:

- D1 migration `0002_login_defenses.sql`
- account failed-login counters and temporary account lockout state
- hashed auth-attempt buckets for client-address rate limiting without plaintext IP storage
- hashed failure buckets advanced through D1 conflict updates to avoid stale read-then-write counters under concurrent failed attempts
- client-address extraction from `CF-Connecting-IP`, first `X-Forwarded-For`, or `unknown`
- password-grant IP failed-attempt rate limit with `429` and `Retry-After`
- password-grant account lockout with generic `invalid_grant` wording
- reset of account login-defense state after successful password grant
- tests for domain policy, migration shape, repository persistence, and HTTP route behavior
- Week 17 dynamic workflow artifacts

Not implemented:

- scheduled auth-attempt retention cleanup job
- live D1 migration application
- live client verification under lockout/rate-limit conditions

## Week 18 Increment

Implemented:

- RFC-compatible HOTP/TOTP helpers using Web Crypto
- base32 TOTP secret generation without padding
- D1 migration `0003_totp_login.sql`
- `user_totp` persistence for encrypted setup secrets, enabled state, verified timestamp, and accepted timestep replay guard
- `totp_challenges` persistence for hashed, device-bound, expiring, single-use login challenges
- AES-GCM TOTP secret envelope using `HONOWARDEN_TOTP_SECRET`; plaintext TOTP secrets are only returned by the authenticated setup route
- authenticated `POST /identity/accounts/totp/setup`
- authenticated `POST /identity/accounts/totp/setup/verify`
- password-grant TOTP challenge response after primary password success for TOTP-enabled users
- password-grant TOTP challenge verification before token issuance
- invalid code, consumed challenge, wrong device, and repeated timestep rejection through generic invalid-grant behavior
- `GET /api/sync` profile `TwoFactorEnabled` derived from stored account state
- tests for domain code generation, secret encryption, migrations, repository atomicity, setup routes, challenge login, replay rejection, and sync profile state
- Week 18 dynamic workflow artifacts

Not implemented:

- live D1 migration application
- live client verification for TOTP setup or login
- scheduled challenge retention cleanup job
- recent re-auth requirements for sensitive operations

## Week 19 Increment

Implemented:

- access token `authMethod` claim for newly issued tokens
- password-grant access tokens marked with `authMethod: "password"`
- refresh-grant access tokens marked with `authMethod: "refresh"`
- backward-compatible bearer token verification for legacy claimless tokens on normal API routes
- fail-closed recent-password-auth guard for sensitive TOTP setup routes
- `POST /identity/accounts/totp/setup` requires a password-auth token issued within five minutes
- `POST /identity/accounts/totp/setup/verify` requires a password-auth token issued within five minutes
- stale password-auth tokens, refresh-auth tokens, and legacy claimless tokens are rejected with `reauth_required` on TOTP setup routes
- tests for token claim validation, grant-specific token issuance, recent-auth success, stale-token rejection, refresh-token rejection, and legacy-token rejection
- Week 19 dynamic workflow artifacts

Deferred at that checkpoint:

- server-side user export API (implemented later in
  `Week 26 User Backup Export API`)
- live client re-auth evidence (captured later for CLI plus HTTP auth
  lifecycle in `Week 26 Live Client Evidence`)

The project remains pre-alpha and must not be used to store real secrets.

## Week 20 Increment

Implemented:

- operator backup/restore CLI wrapper under `scripts/honowarden-backup.mjs`
- `pnpm backup:export` and `pnpm backup:restore`
- dry-run default behavior for export and restore planning
- D1 export planning through `wrangler d1 export`
- D1 restore planning through `wrangler d1 execute --file`
- R2 object get/put planning from either an explicit object key list or
  automatic remote R2 listing
- automatic remote R2 object discovery through the R2 S3-compatible
  `ListObjectsV2` API, with prefix filtering and bounded pagination
- backup manifest with schema version, source resource names, object list
  source, planned commands, and restore hint
- SHA-256 file hashes added to the manifest after executed export
- restore execution preflight for manifest schema, deterministic R2 key/file
  mapping, safe relative paths, required checksums, and checksum matches
- restore `--execute` guard requiring `--confirm-fresh-target`
- local-only `--persist-to` handling for commands that support it
- backup/restore runbook under `docs/operations/backup-restore.md`
- tests for export planning, automatic R2 listing, empty and paginated object
  lists, duplicate listed keys, restore planning, flag scoping, path traversal
  rejection, object key/file mismatch rejection, fresh-target confirmation, and
  checksum mismatch rejection
- Week 20 dynamic workflow artifacts

Not implemented:

- scheduled backup job
- remote production backup execution
- live restore drill evidence

The project remains pre-alpha and must not be used to store real secrets.

## Week 21 Increment

Implemented:

- secret-safe audit event domain model under `src/domain/audit.ts`
- audit event serialization as structured JSON lines
- sensitive audit context key filtering for password, token, secret, hash, key, encrypted payload, and body-like fields
- opt-in audit logging through `HONOWARDEN_AUDIT_LOGS=true`
- fail-closed Wrangler defaults with audit logging disabled in development, staging, and production configs
- audit events for successful restricted account bootstrap
- audit events for failed password-grant attempts that reach credential validation
- audit event for refresh-token reuse detection
- audit event for user backup export success and database-failure outcomes
- audit events for successful and not-found device revoke attempts
- docs for audit event shape, implemented event names, non-goals, and operator notes
- tests proving audit builder sanitization and route-level opt-in event emission
- Cloudflare Workers Logs are enabled through Wrangler observability, and
  Workers Trace Events Logpush is now configured to push `honowarden` and
  `honowarden-staging` runtime metadata to a dedicated R2 bucket
- `docs/release/log-retention-evidence.md` records the Logpush job, R2 sink,
  retention/access policy, and staging/production smoke readback without
  tokens, destination credentials, request bodies, or user secrets

Not implemented:

- automated backup audit ingestion beyond the CLI audit packet and Week 20
  runbook evidence

## Week 26 Audit Event Persistence

Implemented:

- forward-only D1 migration `migrations/0007_audit_events.sql`
- `audit_events` table with explicit event metadata columns and sanitized
  `context_json`
- request ID, event name, actor, and timestamp indexes for incident review
- opt-in D1 persistence behind the existing `HONOWARDEN_AUDIT_LOGS=true` gate
- preservation of console JSON-line audit output
- fail-loud behavior when opt-in audit persistence cannot write to D1
- 365-day audit row retention with bounded cleanup of at most 100 rows per
  inline password-grant maintenance slice or scheduled Worker run when audit
  logging is enabled
- docs for retention, operator-only access, incident export query shape, and
  deletion policy
- tests for migration shape, repository sanitization, route persistence, audit
  persistence failure behavior, and scheduled retention cleanup

Not implemented:

- production migration/deploy for `0007_audit_events.sql`
- enabling audit logging in staging or production
- audit events for unsupported organization and public sharing surfaces

## Week 26 Vault Audit Coverage

Implemented:

- opt-in `folder.create`, `folder.update`, and `folder.delete` audit events
- opt-in `cipher.create`, `cipher.update`, `cipher.delete`,
  `cipher.restore`, and `cipher.permanent_delete` audit events
- opt-in `attachment.create` and `attachment.delete` audit events
- route audit contexts limited to enum-like result status, IDs, booleans, type,
  and size metadata; no encrypted folder names, cipher JSON, attachment keys,
  R2 object keys, request bodies, response bodies, bearer tokens, or secrets
- backup CLI stdout `audit` packet for export and restore with action name,
  result status, and manifest SHA-256 id only
- route and CLI tests proving secret-safe event/payload boundaries

Not implemented:

- live backup/restore execution audit evidence
- audit coverage for organization/shared-vault and public sharing surfaces

## Week 26 User Backup Export API

Implemented:

- recent password-authenticated `POST /api/accounts/export`
- fail-closed reuse of the existing five-minute recent-auth guard
- owner-scoped export of account metadata, active folders, ciphers, and cipher
  attachment metadata
- response cache prevention with `Cache-Control: no-store` and a
  download-oriented `Content-Disposition` filename
- export response excludes master password hashes, refresh-token rows, TOTP
  setup secrets, internal R2 object keys, raw R2 object bodies, and cross-user
  rows
- `backup.export` audit event coverage with count-only context when
  `HONOWARDEN_AUDIT_LOGS=true`
- HTTP tests for owner-scope, recent-auth rejection, sensitive field omission,
  no R2 object-key exposure, and audit-event secrecy
- docs for rate-limit boundary, audit behavior, database-failure behavior, and
  the separation between user export and operator disaster-recovery backup CLI

Not implemented:

- live official-client user export evidence
- production enablement of the opt-in global request quota
- external abuse notification sink or dashboard
- Worker deploy or production smoke for the export route

## Week 26 Global Request Quotas

Implemented:

- opt-in global request quota middleware controlled by
  `HONOWARDEN_GLOBAL_REQUEST_QUOTA`
- separate D1 `request_quota_buckets` table with hashed bucket keys, scope,
  request count, window start, blocked-until timestamp, and cleanup indexes
- anonymous and bearer-present request scopes with one-minute quota windows
- stable `429 rate_limited` responses with `Retry-After` only when quota is
  exceeded
- fail-loud `503 database_unavailable` behavior when quota persistence fails
- health and CORS preflight bypasses so probes and browser preflights do not
  consume quota
- bounded scheduled cleanup of expired request quota buckets when the quota is
  enabled
- `pnpm abuse:report` dry-run-first query packet for request quota and auth
  failure bucket summaries without plaintext IP storage
- operator-facing alert packet for active blocked quota buckets, active locked
  auth-failure buckets, cleanup backlog pressure, and repeated scheduled
  cleanup failures
- docs under `docs/operations/request-quotas.md`

Not implemented:

- production enablement of `HONOWARDEN_GLOBAL_REQUEST_QUOTA`
- external abuse notification sink or dashboard
- per-user quota buckets beyond the current hashed client-address strategy

## Week 22 Increment

Implemented:

- fixture-flow manifest under `compat/fixture-flows.json`
- matrix validation that every declared covered flow maps to at least one fixture file
- compatibility fixtures for folder create, update, and delete
- compatibility fixtures for login cipher create, update, trash, restore, and permanent delete
- compatibility fixtures for stale revision conflict, device revoke, TOTP login challenge, and TOTP login success
- sync fixture with one folder and one active cipher in addition to the empty-vault sync fixture
- fixture assertion support for array indexes, absent fields, array length checks, minimum lengths, and `notValue`
- refresh rotation fixture assertion that the returned refresh token differs from the presented token
- docs for the fixture manifest and current fixture-covered flow list
- Week 22 dynamic workflow artifacts

Not implemented:

- stateful route-executed fixture replay for mutating compatibility fixtures
- broad live client binary evidence for all tracked versions
- sync of trashed cipher tombstones in `/api/sync`
- promotion beyond `fixture_only` for non-CLI surfaces

## Week 23 Increment

Implemented:

- FakeD1 multi-user lookup by normalized email and user ID for app-level tests
- FakeD1 folder and cipher list filtering by bound user ID
- HTTP test proving mixed Alice/Bob sync returns only the authenticated user's folders and ciphers
- HTTP test proving disabled users cannot complete password grants with valid credentials
- HTTP test proving disabled users cannot refresh tokens before rotation
- generic invalid-grant wording preserved for disabled auth failures
- Week 23 dynamic workflow artifacts

Not implemented:

- production two-user dogfood evidence
- production disabled-user lifecycle operation
- shared vault or Organization isolation
- account lifecycle admin UI

## Week 24 Increment

Implemented:

- security review index under `docs/security/review-index.md`
- threat model with assets, actors, trust boundaries, STRIDE summary, attack surface, and high-risk abuse paths
- security data-flow document for bootstrap, auth, sync, TOTP, audit logs, and backup/restore
- authentication state machine for account, password grant, refresh grant, access-token verification, and device revoke states
- secrets inventory for runtime secrets, non-secret runtime config, sensitive stored data, and rotation notes
- incident response runbook covering detection, triage, containment,
  communication, recovery, and postmortem paths for token leaks, vault exposure
  suspicion, email abuse, and Cloudflare compromise
- incident response tabletop evidence with follow-up gaps mapped to Linear
  issues
- Cloudflare access-control review documenting redacted member/role/token
  readback, least-privilege token plan, accepted temporary break-glass risk, and
  review cadence
- known limitations document preserving pre-alpha and no-independent-audit warnings
- dependency audit evidence with package manager output and lockfile SHA-256
- `SECURITY.md` link to the security review materials
- CI-backed security docs test under `test/security-docs.test.ts`
- dependency audit evidence with no known vulnerabilities found on 2026-07-06
- Week 24 dynamic workflow artifacts

Not implemented:

- independent security audit
- external penetration test
- full Cloudflare account hardening after the scoped-token rollout: 2FA
  enforcement, broad role reduction, legacy no-expiry token retirement, and
  break-glass global-key rotation
- live incident, real secret rotation, or external communications drill
- live staging or production secret rotation drill

## Week 25 Increment

Implemented:

- release readiness index under `docs/release/index.md`
- feature-freeze checklist with release hold conditions and local gates
- fresh deploy guide for staging-first Cloudflare Workers, D1, and R2 setup
- upgrade guide with backup-first and migration policy
- rollback guide separating Worker rollback from fresh-target data restore
- migration freeze document with SHA-256 hashes for all current migrations
- draft `v0.1.0-alpha` release notes with scope, exclusions, operations links, and release gates
- CI-backed release docs test under `test/release-docs.test.ts`
- README link to release readiness materials
- Week 25 dynamic workflow artifacts

Not implemented:

- `v0.1.0-alpha` tag
- live staging deploy evidence
- production backup/restore drill evidence
- live client matrix promotion

The project remains pre-alpha and must not be used to store real secrets.

## Linear Tracking Setup

Implemented:

- Linear seed validation script exposed as `pnpm linear:seed`
- HonoWarden Linear seed updated with the current post-publication Week 26
  status
- Linear seed issue states now distinguish 14 completed alpha/ops items from
  four started follow-ups: domain email, live-client evidence expansion, TOTP
  change management, and rollback rehearsal evidence
- `pnpm linear:seed` now validates issue `stateType` values and reports issue
  state counts
- read-only `pnpm linear:preflight` verifies `LINEAR_API_KEY` against the
  expected Linear workspace slug, team, and workflow state types before any live
  seed application
- local-only `pnpm linear:apply-plan` turns the seed and an optional ready
  preflight report into a reviewable apply plan without reading credentials or
  mutating Linear
- local-only `pnpm linear:mutation-packet` turns a ready apply-plan JSON into a
  reviewable mutation packet for a future guarded writer without reading
  credentials or mutating Linear
- local-only `pnpm linear:request-plan` turns a ready mutation packet into a
  deterministic executor contract with local intent names and unresolved ID
  requirements, without reading credentials or mutating Linear
- local-only `pnpm linear:resolution-plan` verifies a ready request plan against
  a supplied local Linear ID map and reports missing IDs without reading
  credentials or mutating Linear
- README link to `docs/operations/linear-tracking.md`
- access guard documented to prevent writing HonoWarden issues into an unrelated
  Linear workspace
- dynamic workflow artifacts for the Linear tracking update

Not implemented:

- live Linear issue/project/view creation, because the available Linear MCP
  connection currently resolves to another workspace and the DevTools browser is
  not authenticated to `linear.app/honowarden`
- Pulse workspace settings mutation
- Linear custom view creation through UI automation
- live Linear application of the updated issue states and published-alpha view
- live mutation support inside the apply-plan command; it intentionally remains
  a non-mutating planning step until strict preflight and write-scope evidence
  are available
- live mutation support inside the mutation-packet command; it intentionally
  omits blocked-plan steps and does not resolve Linear IDs or execute writes
- live mutation support inside the request-plan command; it intentionally
  avoids unverified live GraphQL mutation names and only records the local
  intent/ID-resolution contract for a future guarded writer
- live mutation support inside the resolution-plan command; it intentionally
  verifies only local ID-map completeness and does not call Linear or execute
  writes

The Linear seed remains the source of truth until a connector, browser session,
or strict API preflight is authenticated to the `honowarden` workspace and the
reviewed apply plan, mutation packet, request plan, and resolution plan are
executed by a separate guarded write path.

## Operator Environment Setup

Implemented:

- tracked `.envrc` with non-secret project defaults for direnv
- ignored `.env.local` and `.envrc.local` local secret sources
- `.env.example` placeholders for Linear, GitHub, Cloudflare, email forwarding,
  and local Worker smoke variables
- direnv watch rules for local secret files
- `.env.local` is loaded with `dotenv_if_exists`, so dotenv-style `KEY=value`
  operator inputs are exported to child processes
- CI-covered operator environment policy tests under
  `test/ops/operator-environment.test.ts`
- read-only `pnpm email:preflight` for Email Routing readiness without printing
  token, global key, operator email, or destination values
- Email Routing preflight tests under `test/ops/email-preflight.test.ts`
- Cloudflare global API key auth is stored outside the repository under the
  operator's home config and sourced through ignored `.envrc.local`
- scoped HonoWarden Cloudflare account token placeholders for deploy,
  DNS/routes, Email Routing, D1/R2, and read-only evidence tasks
- scoped Cloudflare token generation/verification script exposed as
  `pnpm cloudflare:tokens`
- live scoped-token readback recorded in
  `docs/operations/cloudflare-access-control.md`; the five scoped tokens expire
  on `2026-10-07T23:59:59Z`
- ignored local Email Routing inputs are now configured for Cloudflare auth,
  account id, zone id, and all six destination variables

Not implemented:

- live Linear API writes with a HonoWarden workspace key
- security metadata publication and AI inquiry inbox implementation after
  verified Email Routing
- raw MIME and attachment storage for the inquiry inbox

## Week 26 Release Gate Preflight

Implemented:

- read-only release gate preflight script exposed as `pnpm release:gate`
- strict mode for release automation through `pnpm release:gate -- --strict`
- JSON report that separates passed repository evidence from alpha blockers
- release docs link and usage guide for the preflight
- tests covering current `not_ready` behavior and strict-mode failure
- dynamic workflow artifacts for release gate preflight

Current blockers reported by the preflight:

- synthetic live-client evidence is still fixture-only

The preflight is intentionally read-only and does not tag, deploy, call
Cloudflare, call Linear, or contact external client services.

## Week 26 Backup Restore Drill Evidence

Implemented:

- local synthetic backup export and fresh-target restore drill
- restored D1 schema verification against a separate local persistence target
- release evidence document under
  `docs/release/backup-restore-drill-evidence.md`
- release gate preflight validation for required backup evidence fields

Not implemented:

- remote Cloudflare backup/restore drill
- R2 object restore evidence with non-empty object list
- production-like restore evidence

## Week 26 Staging Dry Run Evidence

Implemented:

- local `pnpm staging:dry-run` wrapper around
  `wrangler deploy --env staging --dry-run --outdir ...`
- staging configuration checks for Worker name, D1 binding, R2 binding,
  environment label, fail-closed bootstrap default, audit default, and
  staging/production separation
- generated Worker bundle size and SHA-256 recording
- release evidence document under `docs/release/staging-deploy-evidence.md`
- release gate validation for required staging dry-run evidence fields
- tests covering the dry-run wrapper and updated release gate state

Current blockers reported by the preflight:

- none after CLI and browser-extension live-client evidence was recorded
  locally

Not implemented:

- real Cloudflare staging deploy
- deployed Worker HTTP health smoke
- desktop and iOS live client evidence

## Week 26 Cloudflare Resource Evidence

Implemented:

- created Cloudflare D1 databases for staging and production in the gHive
  account
- created Cloudflare R2 buckets for staging and production in the gHive account
- replaced D1 placeholder IDs in `wrangler.jsonc` with the created D1 IDs
- applied remote staging D1 migrations through `0001`, `0002`, and `0003`
- verified remote staging `schema_migrations` and schema tables
- release evidence document under
  `docs/release/cloudflare-resource-evidence.md`
- release gate validation for required Cloudflare resource evidence fields and
  non-placeholder D1 IDs

Current blockers reported by the preflight:

- none after CLI and browser-extension live-client evidence was recorded
  locally

Not implemented:

- Worker deploy
- secret writes
- route writes
- production migration apply
- deployed Worker HTTP health smoke
- desktop/mobile live client evidence

## Week 26 Live Client Evidence

Implemented:

- local wrangler dev smoke using the tracked CLI `2026.6.0`
- synthetic account seed through `POST /api/accounts/bootstrap`
- generated synthetic account key material with the tracked CLI wasm primitives
- `/identity/accounts/prelogin/password` alias for current CLI prelogin
- account key metadata and master-password unlock data in token and sync responses
- form-field device metadata support for password grant requests
- authenticated `GET /api/accounts/revision-date`
- CLI login success with session key length `88`
- CLI sync success with `Syncing complete.`
- `compat/client-matrix.json` CLI row promoted to `live_smoke`
- release evidence document under `docs/release/live-client-evidence.md`
- release gate update requiring linked live evidence for promoted matrix rows
- Android client release metadata refreshed to `2026.6.1` build `21713`
- official browser extension `2026.6.1` asset provenance and SHA-256 evidence
- browser-extension self-hosted host selection against local wrangler dev
- browser-extension password login, `/api/sync`, account profile reads, and
  empty-vault render with redacted evidence
- `compat/client-matrix.json` browser extension row promoted to `live_smoke`
- browser-extension release evidence document under
  `docs/release/browser-extension-live-client-evidence.md`
- official Android F-Droid APK `2026.6.1` build `21713` asset provenance and
  SHA-256 evidence
- Android self-hosted host selection through a temporary trycloudflare tunnel
  against local wrangler dev
- Android password login, `/api/sync`, billing subscription read, config
  refresh, and empty-vault render with redacted evidence
- official Android Retrofit live diagnostic for `/api/sync` response parsing
- server response timestamp normalization from SQLite `CURRENT_TIMESTAMP`
  format to UTC ISO-8601 for mobile compatibility
- `compat/client-matrix.json` Android row promoted to `live_smoke`
- Android release evidence document under
  `docs/release/android-mobile-live-client-evidence.md`
- iOS client release metadata refreshed to `2026.6.1` build `3376` while
  keeping the row at `fixture_only`
- iOS live smoke split to Linear `HON-65` because it requires a
  physical/provisioned iOS run target or simulator-compatible signed artifact
- release gate update listing all promoted row live-evidence paths
- official CLI one-step TOTP password grant live evidence
- direct HTTP TOTP setup, change, disable, refresh-grant recent-auth rejection,
  and revoke-all-other-sessions live evidence using synthetic local state
- `compat/client-matrix.json` CLI row linked to
  `docs/release/totp-recent-auth-live-evidence.md`
- release gate update requiring the TOTP/recent-auth evidence markers whenever
  the CLI live-evidence flow list claims `totp_login`

Not implemented:

- desktop live evidence
- iOS live evidence (`HON-65`)
- browser-extension, desktop, Android, or iOS TOTP UX evidence
- live item mutation evidence beyond the existing CLI smoke

## Week 26 Server Config Fixture Coverage

Implemented:

- compatibility fixture flow `config` for anonymous `GET /api/config`
- deterministic assertions for server config version, object type, replay
  origin URLs, disabled registration, and push metadata
- route replay coverage for the config fixture against the Hono app

Not implemented:

- live evidence for non-CLI clients reading server config
- custom server config feature flags beyond the current alpha defaults

## Week 26 Retention Cleanup

Implemented:

- bounded inline cleanup on the password-grant token path
- stale `auth_attempts` cleanup by retention threshold
- stale, unlocked `auth_failure_buckets` cleanup by retention threshold
- expired or consumed `totp_challenges` cleanup
- idempotent repository cleanup functions with row caps
- shared cleanup implementation reused by both password-grant inline
  maintenance and the Worker scheduled handler
- hourly UTC Cloudflare Cron Trigger configuration for default, staging, and
  production deploy targets
- retention cleanup runbook under `docs/operations/retention-cleanup.md`
- tests for bounded and idempotent auth-defense, TOTP challenge cleanup,
  scheduled handler execution, and cron configuration
- staging and production Cloudflare deploys applying the hourly Cron Trigger
  from source commit `b1270b557c604a868091ec3b4252c9b7566c958b`
- staging and production D1 migrations `0004` and `0005` applied, with
  `/health/db` reporting schema version `0005`
- retention Cron evidence under `docs/release/retention-cron-evidence.md`,
  including deployment IDs, Worker version IDs, synthetic cleanup row setup, and
  rollback/disable procedure
- `pnpm abuse:report` cleanup candidate queries for auth attempts, auth failure
  buckets, TOTP challenges, audit events, and request quota buckets
- operator alert thresholds for cleanup candidate backlog and repeated scheduled
  cleanup failures
- Wrangler tail captured staging and production scheduled events with
  `outcome: ok` at `2026-07-09T16:00:08Z`
- post-hour D1 readback confirmed the synthetic `hon-51-cron-smoke`
  `auth_attempts` and `auth_failure_buckets` rows were deleted in both staging
  and production

Not implemented:

- dedicated cleanup-only indexes for larger production datasets
- external notification sink or dashboard for cleanup alerts

## Week 26 TOTP Setup Guard

Implemented:

- `POST /identity/accounts/totp/setup` rejects accounts that already have TOTP
  enabled
- the enabled-state guard runs before TOTP wrapping-secret checks
- active TOTP rows are not moved back to pending setup state by setup route
  reuse
- regression coverage for the already-enabled setup path

## Week 26 TOTP Disable Route

Implemented:

- authenticated `POST /identity/accounts/totp/disable`
- recent-password-auth requirement (`authMethod=password` within five minutes) for disable attempts
- stable response object shape: `{ object: "totp", enabled: false }`
- deletes the enabled TOTP setup row for the authenticated account
- clears retained TOTP secret and replay state by removing that row
- emits `totp.disable` audit events for route outcomes

## Week 26 TOTP Change Route

Implemented:

- forward-only D1 migration `0004_totp_change.sql` with pending TOTP change
  columns on `user_totp`
- authenticated `POST /identity/accounts/totp/change`
- authenticated `POST /identity/accounts/totp/change/verify`
- recent-password-auth requirement (`authMethod=password` within five minutes)
  for both change start and change verify
- current TOTP code verification before pending replacement secret creation
- pending replacement secret storage without disabling the active TOTP secret
- accepted-step recording for the current code before change start, so current
  code replay fails closed
- pending secret promotion that clears pending state and stores the new accepted
  timestep for replay protection
- `totp.change` audit events for start and verify outcomes
- tests for invalid current code, refresh-auth rejection, pending verify
  promotion, and replay rejection when no pending change remains

## Login With Device Schema Gate

Implemented:

- accepted ADR 0008 for personal-vault auth-request create, approve/deny, poll,
  expiry, single-use consume, notification, audit, retention, and rollback
- forward-only `0012_auth_requests.sql` migration with owner-optional rows,
  access-code hashes, opaque requester public/encrypted response keys, fixed
  expiry, terminal retention, and owner/requester lookup indexes
- schema constraints that reject self-approval identifiers and malformed
  approved, denied, or consumed terminal states

Subsequently implemented and verified in staging:

- default-off create, pending list, owner read, approve/deny, and anonymous
  response-polling routes
- dedicated purpose-separated HMAC verifiers, active approving-device checks,
  requester self-approval rejection, anonymous quotas, secret-safe audit
  events, and bounded expiry/retention cleanup
- compatible official-client request headers and response fields
- live synthetic create, approve, deny, poll, wrong-code, idempotent replay, and
  conflicting replay evidence in
  `docs/release/auth-request-staging-evidence.md`
- replay-safe type `0` token consumption through the public client password
  form extension, with owner/requester/expiry/HMAC binding and conditional D1
  device/session/consume batch
- live auth-request token issuance, authenticated sync, replay rejection,
  refresh rotation, consumed-state readback, and zero-row cleanup evidence
- a staging-detected auth-method verifier regression repaired by PR `#72` and a
  sign-and-verify regression test

Still not implemented:

- notifications, official-client UI evidence, or production enablement

## Inquiry Migration Chain Reconciliation

Implemented:

- restored the exact applied `0009_inquiry_messages.sql` file at its original
  SHA-256 after discovering that remote D1 retained version 0009 while the file
  had disappeared from the repository
- added forward-only `0010a_inquiry_message_reconciliation.sql` before 0011
- renames the legacy table to `legacy_inquiry_messages_0009` without deleting
  rows, releases its old index names, and recreates equivalent legacy indexes
- allows 0011 to create the current thread/message/event schema under its
  intended names
- verified a fresh local D1 applies all migrations through 0012 and contains
  both preserved legacy and current inquiry tables

Staging live reconciliation passed after PR #64 merged:

- `0010a`, `0011`, and `0012` applied in order and migration readback reports
  no pending files
- `legacy_inquiry_messages_0009`, current `inquiry_threads`,
  `inquiry_messages`, `inquiry_events`, and `auth_requests` coexist
- legacy, current, and auth-request row counts were all zero at readback, so no
  rows were lost or rewritten

Production was not modified. Its reconciliation remains gated with the broader
HON-79 production rollout after repository and route lifecycle evidence passes.

## Week 26 Unsupported Surface Guards

Implemented:

- explicit `501` JSON response for `/api/organizations` and child paths
- explicit `501` JSON response for `/api/sends` and child paths
- explicit `501` JSON response for collection, emergency-access, and top-level
  `/api/attachments` paths
- explicit `501` JSON response for disabled or unsupported auth-request methods
- request ID preservation on unsupported feature responses
- route test coverage proving these paths do not fall through to generic `404`

Not implemented:

- organization membership, roles, shared-vault functionality, or shared
  collection assignment
- public file-sharing functionality
- collection or emergency-access functionality
- login-with-device token consumption, push notification, or official-client UI
  evidence
- top-level attachment collection APIs outside the cipher-scoped upload,
  download, and delete routes

## Week 26 Revoke Other Sessions

Implemented:

- authenticated `POST /api/devices/revoke-all`
- recent password authentication requirement for revoke-all-other-sessions
- refresh-auth token rejection with `reauth_required`
- D1 batch update that revokes other active devices and their refresh tokens
- current device/session preservation in the response contract
- `session.revoke_all` audit event
- repository and HTTP tests for current-device preservation and recent-auth
  enforcement

Not implemented:

- browser-extension, desktop, Android, or iOS live client evidence for
  revoke-all-other-sessions
- account management UI or admin tooling for session inventory

## Week 26 Device List API

Implemented:

- authenticated `GET /api/devices`
- authenticated `GET /api/devices/identifier/:identifier`
- owner-scoped read-only device metadata queries for user inventory and identifier
  lookup
- compatibility fixture flow `device_read` for device list and identifier
  lookup responses

Not implemented:

- encrypted device key update live-client evidence

## Week 26 Device Metadata Update API

Implemented:

- authenticated `PUT /api/devices/:id`
- owner-scoped active-device update by stable device ID and authenticated user ID
- metadata-only updates for device `name` and `type`
- `name`/`Name` and `type`/`Type` request payload aliases
- stable `400`, `401`, `404`, and `503` JSON responses
- compatibility fixture flow `device_update` under
  `compat/fixtures/devices/update-success.json`

Not implemented:

- device identifier mutation
- live client evidence for device metadata update

## Week 26 Device Keys Update API

Implemented:

- forward-only D1 migration `0005_device_keys.sql` for encrypted device user,
  public, and private key columns
- authenticated `PUT`, `POST`, and `PATCH /api/devices/:id/keys`
- authenticated `PUT` and `PATCH /api/devices/:id/trust` compatibility alias
- authenticated bulk `POST /api/devices/update-trust` trusted-device rotation
  workflow
- owner-scoped active-device lookup by stable device ID or device identifier
- required encrypted user/public/private key payload validation with
  upper-camel and lower-camel request aliases
- opaque encrypted key storage without server-side plaintext access
- `isTrusted` response derivation only when encrypted user, public, and private
  key payloads are all present
- response shape returns encrypted user and public keys but never returns the
  encrypted private key
- bulk update response shape returns a device list and never returns encrypted
  private keys
- stable `400`, `401`, `404`, and `503` JSON responses
- compatibility fixture flow `device_keys_update` under
  `compat/fixtures/devices/keys-update-success.json`
- compatibility fixture flow `device_bulk_trust_update` under
  `compat/fixtures/devices/bulk-update-trust-success.json`

Not implemented:

- login-with-device approval, push notification, or pending auth-request flows
- live client evidence for encrypted device key and bulk trust update

## Week 26 Known-Device Preflight API

Implemented:

- anonymous `GET /api/devices/knowndevice`
- header contract:
  - `X-Request-Email`: base64url-encoded UTF-8 email for the candidate user
  - `X-Device-Identifier`: client device identifier
- response is boolean `true` when the device is known for the email and `false`
  otherwise
- missing or malformed header values return `invalid_request`
- returns only preflight result without device metadata mutation, trust updates,
  or key updates
- compatibility fixture flow `known_device_preflight` for the known-device
  boolean response

## Week 26 Account Profile API

Implemented:

- authenticated `GET /api/accounts/profile`
- profile response reuses the same account key metadata, TOTP enabled state,
  organization placeholders, and key-connector defaults as `/api/sync`
- response includes master-password unlock metadata in `UserDecryptionOptions`
  to match the token response contract
- authenticated `PUT` and `POST /api/accounts/profile`
- owner-scoped display-name mutation with account `revision_date` update
- `name`/`Name` request payload aliases with stable invalid-request handling
- compatibility fixture flow `account_profile` under
  `compat/fixtures/accounts/profile-success.json`
- compatibility fixture flow `account_profile_update` under
  `compat/fixtures/accounts/profile-update-success.json`

Not implemented:

- email change or account deletion flows
- live client evidence for the account profile endpoint

## Week 26 Account Password Verification And Change

Implemented:

- authenticated `POST /api/accounts/verify-password` using the current
  client-derived authentication hash and the existing credential-proof defenses
- authenticated `POST /api/accounts/password` with pinned structured,
  transitional legacy, and dual request variants
- fail-closed dual-payload consistency checks plus unchanged account salt and
  KDF generation checks
- explicit rejection of non-empty password hints because HonoWarden does not
  persist hint data
- one generation-guarded D1 batch that replaces the authentication hash and
  opaque wrapped user key, rotates security stamp/revision, revokes devices and
  refresh tokens, supersedes active auth requests, and persists the required
  `account.password.change` audit event
- old access-token invalidation through security-stamp rotation and old refresh
  invalidation through D1 session revocation
- compatibility fixture flows `password_verify` and `password_change`
- `pnpm account:password-change:lifecycle` real local-D1 synthetic evidence for
  old/new login, verify, refresh, sync, audit, KDF, session, and encrypted-vault
  invariants

Not implemented:

- password-hint persistence or migration; non-empty hints fail before mutation
- official client UI or production password-change evidence

## Week 26 Account KDF Change

Implemented:

- authenticated `POST /api/accounts/kdf` with current client-derived hash proof,
  unchanged normalized-email salt, and matching authentication/unlock data;
  the writer is default-off behind `HONOWARDEN_KDF_MUTATION_ENABLED`
- inclusive PBKDF2-SHA256 bounds `600000..2000000` and client-safe Argon2id
  bounds of iterations `2..10`, memory `16..1024` MiB, and parallelism
  `1..16`; the pinned server accepts 15 MiB, but pinned clients reject it
- one generation-guarded D1 batch that replaces the authentication hash, opaque
  wrapped user key, and KDF columns; rotates security stamp/revision; revokes
  devices and refresh tokens; supersedes active auth requests; and persists the
  required `account.kdf.change` audit event
- exact stored KDF projection through known-account prelogin, password and
  refresh token responses, account profile unlock metadata, and sync unlock
  metadata; one prelogin D1 snapshot also returns the grouped client-readable
  stored KDF population, and unknown allowed accounts receive an email-stable,
  secret-keyed selection from that population weighted by account count,
  including readable legacy tuples and only valid resource profiles already in
  use; unrelated malformed rows are excluded, an invalid target fails closed,
  and an empty valid population falls back to bootstrap PBKDF2 `600000`
- post-commit notification cleanup runs through `waitUntil`; latency cannot
  delay the 200 acknowledgement, and failure is logged without changing it, so
  supported clients persist the already committed local KDF
- fail-closed stored-KDF validation at the auth repository boundary so unknown
  algorithms cannot be silently projected as PBKDF2 after session mutation
- `pnpm account:kdf-change:lifecycle` real local-D1 synthetic evidence for
  a PBKDF2-to-Argon2id-to-PBKDF2 round trip, rejection of both prior credential
  and session generations, exact login/profile/sync projections, two direct
  revision advances, two audit rows, and encrypted-vault preservation

Not implemented:

- official client UI or production KDF-change evidence; those remain aggregate
  credential closeout work and do not promote compatibility rows
- deployed writer activation; tracked development, staging, and production
  configurations remain false until a reader-capable rollback version exists

## Week 26 Account Lifecycle Operator CLI

Implemented:

- `pnpm account:lifecycle -- disable` and `pnpm account:lifecycle -- enable`
  wrappers around `wrangler d1 execute`
- dry-run by default JSON packet with pre-operation readback, guarded mutation,
  post-operation readback, inverse rollback command, reason, and target hash
- exact `--confirm <target>` requirement before `--execute`
- email or user-id selectors with SQL literal escaping and normalized-email
  handling
- local and remote D1 modes, including `--env` and local-only `--persist-to`
- operator runbook under `docs/operations/account-lifecycle.md`

Not implemented:

- admin UI for account lifecycle operations
- production disabled-user lifecycle execution beyond dry-run planning and
  synthetic local evidence

## Week 26 Two-User Dogfood Evidence

Implemented:

- `pnpm dogfood:evidence:packet` synthetic evidence packet generator
- strict required-flow coverage for two synthetic bootstraps, two-user sync,
  cross-user read and mutation denials, disabled password grant, disabled
  refresh grant, disabled sync, disabled vault CRUD, and enable rollback
  planning
- URL redaction, safe evidence directory checks, exactly-two synthetic user tag
  checks, and synthetic-only policy checks
- stateful FakeD1 account bootstrap support for tests that need inserted users
  to be visible to later auth lookups
- focused app-level test that bootstraps two synthetic users in the same fake
  database, proves owner-scoped sync/read/mutation behavior, disables one user,
  and verifies password grant, refresh grant, sync, and vault CRUD denial
- release evidence document under
  `docs/release/two-user-dogfood-evidence.md`

Not implemented:

- production account disable/enable execution for non-operator accounts
- real official-client dogfood run for browser, desktop, or mobile surfaces

## Week 26 Account Revision API

Implemented:

- authenticated `GET /api/accounts/revision-date`
- scalar JSON timestamp response using the account revision date
- compatibility fixture flow `account_revision` under
  `compat/fixtures/accounts/revision-date-success.json`

Not implemented:

- account revision mutation APIs
- live client evidence beyond the CLI smoke revision lookup

## Week 26 Direct Vault Read APIs

Implemented:

- authenticated `GET /api/folders`
- authenticated `GET /api/folders/:id`
- authenticated `GET /api/ciphers`
- authenticated `GET /api/ciphers/:id`
- folder reads are active-only and owner-scoped
- cipher reads include active and trashed items, matching `/api/sync`
- folder and cipher list responses use bounded keyset pagination with stable
  `continuationToken` values
- default direct list page size is 100 and explicit `pageSize`/`limit` values
  must be between 1 and 500
- malformed or cross-resource continuation tokens return `invalid_request`
- compatibility fixture flow `direct_read` for folder and cipher list/get
  responses

Not implemented:

- collection-scoped reads
- live client evidence for direct folder or cipher read endpoints

## Week 26 Attachment Storage APIs

Implemented:

- forward-only D1 migration `0006_cipher_attachments.sql` for
  owner-scoped attachment metadata
- `cipher_attachments` required-table health coverage
- authenticated `POST /api/ciphers/:id/attachment` multipart upload
- authenticated `GET /api/ciphers/:id/attachment/:attachmentId` download
- authenticated `DELETE /api/ciphers/:id/attachment/:attachmentId` delete
- server-generated R2 object keys under `attachments/<uuid>` that do not embed
  plaintext user IDs, cipher IDs, filenames, or emails
- attachment metadata storage for opaque client-encrypted `fileName` and
  attachment `key` values
- upload failure cleanup that deletes the just-written R2 object when metadata
  persistence fails
- attachment download and delete authorization through `user_id`, `cipher_id`,
  and attachment `id` predicates
- cipher read/list/sync responses inject D1 attachment metadata and never expose
  the internal R2 object key
- compatibility fixture flow `attachment_metadata` proving sync metadata shape
- HTTP tests for upload, missing/cross-user cipher rejection, download,
  cross-user denial, delete, and sync metadata injection
- repository tests for attachment create/list/find/delete owner predicates

Not implemented:

- live official-client attachment upload/download/delete evidence
- top-level `/api/attachments` collection APIs
- server-side plaintext inspection, scanning, or filename parsing

## Week 26 Metadata Read APIs

Implemented:

- authenticated `GET /api/policies`
- authenticated `GET /api/policies/new`
- authenticated `GET /api/domains`
- authenticated `GET /api/settings/domains`
- authenticated `POST /api/settings/domains`
- authenticated `PUT /api/settings/domains`
- policy endpoints return empty list responses for the alpha personal-vault
  scope
- policy mutation and organization policy enforcement are excluded by ADR 0006;
  no organization policy applies to personal-vault users
- domain endpoints and `/api/sync` reuse the same owner-scoped custom
  equivalent-domain metadata from the user row
- custom equivalent-domain updates replace the owner-scoped `string[][]` set;
  submitting an empty set deletes the custom domain rules
- global equivalent-domain rules stay empty in the alpha scope, and
  organization-scoped domain rules are intentionally not implemented until an
  organization model exists
- compatibility fixture flow `metadata_read` for policy and domain responses

Not implemented:

- policy management, policy mutation, or organization policy enforcement
- organization-scoped equivalent-domain configuration
- live client evidence for metadata read endpoints

## Week 26 Collection Metadata Read API (Superseded By ADR 0010)

Implemented:

- ADR 0007 originally exposed authenticated empty/not-found collection metadata
  for the alpha personal-vault product line
- ADR 0010 superseded that staged boundary when the team-vault product line was
  adopted
- until Organizations Slice 2 lands, collection reads and mutations now return
  explicit `unsupported_feature` responses so clients cannot infer partial
  collection support
- compatibility fixtures under `metadata_read` record that typed boundary

Not implemented:

- collection reads, creation, update, deletion, or assignment behavior
- organization-scoped collection APIs
- live client evidence for collection metadata reads

## Week 26 Fixture Route Replay

Implemented:

- route-executed compatibility fixture replay for deterministic stateless
  fixtures and selected explicitly opted-in stateful fixtures
- replay coverage for server config, prelogin, password grant, refresh grant,
  TOTP challenge, TOTP login success, empty sync, sync with one folder and
  cipher, account profile, account revision, folder reads and mutations, direct
  cipher reads and mutations, stale revision conflict, policy metadata, domain
  metadata, collection metadata, device reads, device metadata update,
  known-device preflight, and device revoke/session revoke
- password-grant replay uses fixture request headers/form data and explicitly
  opts into stateful replay while preserving the default mutating fixture guard
- refresh-grant replay seeds a deterministic refresh-token session and verifies
  token rotation through the real token route with explicit stateful replay
  opt-in
- TOTP challenge replay seeds a synthetic TOTP-enabled user and verifies the
  continuation response through the real token route with explicit stateful
  replay opt-in
- TOTP login success replay seeds a deterministic device-bound challenge and
  scopes fake system time to the fixture where the declared one-time code is
  valid
- device revoke replay signs the synthetic access token for the fixture owner
  and verifies the real authenticated revoke route with explicit stateful replay
  opt-in
- session revoke replay covers revoke-all-other-sessions using a deterministic
  recent password-authenticated token and fixed system time
- folder mutation replay covers create, update, and delete fixtures through the
  real authenticated folder routes with explicit stateful replay opt-in
- cipher mutation replay covers create, update, trash, restore, permanent
  delete, and stale revision conflict fixtures through the real authenticated
  cipher routes with explicit stateful replay opt-in
- cipher lifecycle route semantics align with the upstream contract:
  `PUT /api/ciphers/:id/delete` trashes, `DELETE /api/ciphers/:id` and
  `POST /api/ciphers/:id/delete` permanently delete, and
  `DELETE /api/ciphers/:id/delete` remains a permanent-delete alias
- route replay tests now enumerate `compat/fixtures/**/*.json` and fail when a
  fixture file is missing a replay entry, a replay entry points to no file, or a
  replay path is duplicated
- route replay tests also compare the replay path set with
  `compat/fixture-flows.json` so matrix flow coverage cannot drift away from
  executable route replay coverage
- deterministic synthetic access-token replacement for fixture requests that
  use `Bearer synthetic-access-token`
- `FakeD1Database` seeding for fixture-backed user, folder, and cipher reads
- assertion-driven replay that checks fixture status and declared fixture
  assertions against actual Hono responses
- explicit stateless replay guard that rejects stateful or mutating fixtures by
  default

Not implemented:

- route-executed replay for future multi-request fixture scenarios that require
  ordered state transitions beyond a single fixture request
- live client evidence for newly route-replayed fixtures

## Week 26 Alpha Version Alignment

Implemented:

- `package.json` version set to `0.1.0-alpha`
- runtime health metadata reports `0.1.0-alpha`
- server config metadata reports `0.1.0-alpha`
- root service metadata includes the same version while retaining explicit
  pre-alpha safety status until a release tag is cut
- release gate checks package version alignment before reporting alpha readiness

Not implemented:

- `v0.1.0-alpha` Git tag
- package publishing
- deployment tied to the version update

## Week 26 Alpha Tag Preflight

Implemented:

- read-only alpha tag preflight exposed as `pnpm release:tag:preflight`
- strict mode for final release-commit validation through
  `pnpm release:tag:preflight -- --strict`
- package version check against `0.1.0-alpha`
- nested strict release gate check before tag commands are emitted
- clean working tree check for normal strict operation
- local `v0.1.0-alpha` tag absence check
- optional read-only remote tag absence check through `--check-remote`
- JSON report with source commit, checks, explicit limitations, and the tag
  commands an operator can run after CI passes

Not implemented:

- `v0.1.0-alpha` Git tag creation
- tag push
- GitHub release publication

## Week 26 Tagging Runbook

Implemented:

- release tagging runbook under `docs/release/tagging-runbook.md`
- explicit preconditions for clean working tree, local tag absence, release gate,
  tag preflight with remote tag absence, CI, and brand scan
- operator approval gate before creating or pushing `v0.1.0-alpha`
- failure handling for local tag cleanup and pushed wrong-tag incident response
- release docs test coverage that keeps tag creation approval-gated
- release gate required-doc coverage for the tagging runbook

Not implemented:

- tag creation
- tag push
- remote tag deletion or retagging
- GitHub release publication

## Week 26 Release Tag Verification Workflow

Implemented:

- GitHub Actions workflow for `v0.1.0-alpha` tag pushes under
  `.github/workflows/release-tag.yml`
- read-only repository permissions for the tag verification job
- full checkout with tags available for tag-context checks
- typecheck, lint, unit tests, compatibility fixture tests, strict release gate,
  release tag preflight, repository brand scan, and format check on the pushed
  tag
- release runbook requirement that the tag verification workflow passes before
  GitHub release publication or deployment approval

Not implemented:

- tag creation
- tag push
- GitHub release publication
- deployment from the tag

## Week 26 Main CI Brand Scan

Implemented:

- normal GitHub Actions CI now runs the repository brand scan on pull requests
  and pushes to `main`
- repository brand scan is exposed as `pnpm brand:scan` through
  `scripts/honowarden-brand-scan.mjs`
- main CI and release tag verification call the shared scan script instead of
  embedding separate workflow shell snippets
- shared scan script uses split-pattern construction, standard-library
  recursive traversal, and the existing generated/dependency exclusions
- focused workflow test under `test/ops/ci-workflow.test.ts` asserts the main CI
  check list, brand scan step, scan ordering before format, read-only
  permissions, and absence of destructive tag/push commands
- focused brand-scan tests assert clean content passes, constructed blocked
  content fails, and excluded paths stay ignored

Not implemented:

- self-referential gating of this workflow's own future CI run
- GitHub release publication
- deployment from a tag or release

## Week 26 GitHub Release Plan

Implemented:

- read-only GitHub release planning script exposed as
  `pnpm release:github:plan`
- release notes section validation for
  `docs/release/v0.1.0-alpha-release-notes.md`
- package version check against `0.1.0-alpha`
- local tag context check for post-tag release planning
- optional read-only remote tag context check through `--check-remote`
- JSON report with draft release command, view command, checks, and explicit
  limitations
- release runbook step requiring the plan to report ready before using the
  printed draft-release command

Not implemented:

- GitHub release draft creation
- GitHub release publication
- release asset upload
- deployment from a release

## Week 26 Release Gate Workflow Coverage

Implemented:

- release gate workflow evidence now covers completed Week 26 live-client,
  item-smoke, ops, TOTP, device, version, tag, tag-verification, and GitHub
  release-planning workflows
- release gate CI evidence detection supports both legacy string checks and
  structured check objects
- completed Week 26 workflow state files include passed GitHub Actions CI run
  evidence where it had not been committed yet
- release gate tests assert representative latest Week 26 workflow evidence

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- `v0.1.0-alpha` tag creation
- tag push
- GitHub release draft creation or publication

## Week 26 Release Approval Packet

Implemented:

- read-only release approval packet exposed as `pnpm release:approval:packet`
- combined JSON summary of strict release gate, remote tag preflight, GitHub
  release planning, CI evidence, and commit alignment
- CI evidence verification through `gh run view`, requiring successful
  completion for the current commit SHA
- machine-generated approval text for `v0.1.0-alpha` tag creation and push
- package command and focused tests that prove the packet does not mutate Git or
  GitHub release state
- tagging runbook step requiring the approval packet to report ready before
  requesting operator approval

Not implemented:

- tag creation
- tag push
- GitHub release draft creation or publication
- deployment from a tag or release

## Week 26 Post-Tag Release Packet

Implemented:

- read-only post-tag release packet exposed as
  `pnpm release:post-tag:packet`
- combined JSON summary of local tag context, remote tag context, tag
  verification workflow evidence, GitHub release planning, and existing release
  state
- remote annotated-tag peeling support so remote tag checks compare the commit
  SHA rather than only the tag object SHA
- machine-generated approval text for creating the GitHub release draft after
  tag verification passes, emitted only when required post-tag evidence is not
  being allowed missing
- focused tests that fake `git` and `gh` instead of creating real tags or
  releases
- tagging runbook step requiring the post-tag packet before release draft
  creation

Not implemented:

- tag creation
- tag push
- GitHub release draft creation or publication
- deployment from a tag or release

## Week 26 Release Gate Packet Coverage

Implemented:

- release gate workflow evidence now requires
  `.workflow/week-26-release-approval-packet/state.json`
- release gate workflow evidence now requires
  `.workflow/week-26-post-tag-release-packet/state.json`
- release gate workflow evidence now requires
  `.workflow/week-26-release-publish-packet/state.json`
- release gate workflow evidence now requires
  `.workflow/week-26-release-published-packet/state.json`
- release gate workflow evidence now requires
  `.workflow/week-26-release-status-packet/state.json`
- completed packet workflow states record their passed GitHub Actions CI run
  IDs
- release gate tests assert the packet workflow evidence paths

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- tag creation
- tag push
- GitHub release draft creation or publication
- deployment from a tag or release

## Week 26 Release Evidence Bundle

Implemented:

- read-only pre-tag evidence bundle exposed as
  `pnpm release:evidence:bundle`
- combined JSON summary of strict release gate, remote tag preflight, release
  approval packet, post-tag dry-run preview, and repository brand scan
- repository brand scan evidence delegates to the shared
  `scripts/honowarden-brand-scan.mjs` policy instead of duplicating traversal
  and pattern logic in the evidence bundle
- optional local `--output` writer for saving the JSON evidence artifact without
  touching external systems
- exact tag approval text emitted only when strict evidence is ready for the
  current commit
- focused tests covering ready output, explicit local evidence output, shared
  scanner failure mapping, and strict failure when CI evidence is absent
- tagging runbook step requiring the evidence bundle before tag approval

Not implemented:

- automatic tag creation
- automatic tag push
- GitHub release draft creation or publication
- deployment from a tag or release

## Week 26 Release Tag Recovery Packet

Implemented:

- read-only release tag recovery packet exposed as
  `pnpm release:tag:recovery`
- lease-guarded recovery command generation for a pushed alpha tag that failed
  verification
- checks for clean working tree, remote main alignment, local tag context,
  remote tag object and peeled commit, latest main CI evidence, failed tag
  workflow evidence, and absence of an existing GitHub release
- machine-generated approval text for moving `v0.1.0-alpha` from the failed
  commit to the verified recovery commit
- focused tests covering ready output, existing-release blocking, and strict
  failure when main CI evidence is absent
- tagging runbook instructions requiring the recovery packet before replacing a
  pushed tag

Not implemented:

- automatic pushed-tag replacement
- remote tag deletion
- remote tag force update
- GitHub release draft creation or publication
- deployment from a tag or release

## Week 26 Release Draft Evidence

Implemented:

- `v0.1.0-alpha` pushed tag points at
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- `Release Tag Verification` GitHub Actions run `28863312935` passed for the
  pushed tag
- GitHub release draft created for `v0.1.0-alpha`
- draft release remains marked as a prerelease
- draft release target commit is
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- draft body contains the required alpha release-note sections
- post-tag release packet reports `status: "ready"` against the created draft

Not implemented:

- GitHub release publication
- deployment from a tag or release

## Week 26 Release Publish Packet

Implemented:

- read-only release publication packet exposed as
  `pnpm release:publish:packet`
- checks for local tag context, remote tag context, tag verification workflow
  evidence, release gate readiness, draft prerelease state, target commit, and
  release-note body sections
- missing tag workflow arguments are filled from the recorded
  `week-26-release-tag-recovery` evidence and revalidated with `gh run view`
- target commit defaults to the local `v0.1.0-alpha` tag commit so the packet
  remains valid after `main` advances
- machine-generated approval text for publishing the draft prerelease
- focused tests covering ready output, non-draft blocking, and strict failure
  when tag workflow evidence is absent
- tagging runbook instructions requiring the publish packet before release
  publication

Not implemented:

- automatic GitHub release publication
- deployment from a tag or release

## Week 26 Release Status Packet

Implemented:

- read-only release status packet exposed as `pnpm release:status:packet`
- aggregation of publish and published packet outputs into a single phase:
  `draft_ready_for_publication`, `published_verified`,
  `published_not_verified`, or `not_ready_for_publication`
- machine-readable next action, approval text, publish command, published
  verification command, and release view command
- tag workflow evidence defaults are propagated into publish and published
  packet readbacks when explicit `--tag-workflow-*` arguments are omitted
- focused tests covering draft-ready, published-verified, and strict
  not-ready states
- tagging runbook instructions requiring the status packet before publication
  and after publication checks

Not implemented:

- automatic GitHub release publication
- deployment from a tag or release

## Week 26 Release Command Repository Scope

Implemented:

- emitted GitHub Release create, view, and publish commands include
  `--repo kazu-42/HonoWarden`
- publish and status packets now surface repo-scoped publication commands
- published verification packet now surfaces a repo-scoped view command
- GitHub release plan, approval packet, post-tag packet, and evidence bundle
  tests assert repo-scoped release commands

Not implemented:

- GitHub release publication
- deployment from a tag or release

## Week 26 Release Gate Command Scope Coverage

Implemented:

- release gate workflow evidence now requires
  `.workflow/week-26-release-command-repo-scope/state.json`
- `week-26-release-command-repo-scope` records passing CI run `28865791573`
- release gate tests assert the command repository-scope workflow evidence path

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- GitHub release publication
- deployment from a tag or release

## Week 26 Publication Gate Runbook

Implemented:

- human-readable publication gate at `docs/release/publication-gate.md`
- release docs index links the publication gate
- release gate required docs include `publication-gate.md`
- release docs tests assert exact publication approval text, repo-scoped publish
  command, status packet command, published packet command, and deploy exclusion

Not implemented:

- GitHub release publication
- deployment from a tag or release

## Week 26 Release Gate Publication Runbook Coverage

Implemented:

- release gate workflow evidence now requires
  `.workflow/week-26-publication-gate-runbook/state.json`
- `week-26-publication-gate-runbook` records passing CI run `28866583897`
- release gate tests assert the publication gate runbook workflow evidence path

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- GitHub release publication
- deployment from a tag or release

## Week 26 Alpha Completion Audit

Implemented:

- read-only alpha completion audit exposed as
  `pnpm release:completion:audit`
- completion audit aggregates strict release gate and release status packet
  output
- non-strict audit reports draft-ready alpha state as incomplete:
  `completion: "incomplete"` and
  `blockingReason: "release_publication_approval_required"`
- strict audit only succeeds after published prerelease verification passes
- focused tests cover draft-ready incomplete, strict draft failure, published
  verified completion, and published verification failure
- publication gate runbook includes pre-publication and post-publication
  completion audit usage

Not implemented:

- GitHub release publication
- deployment from a tag or release

## Week 26 Release Gate Completion Audit Coverage

Implemented:

- release gate workflow evidence now requires
  `.workflow/week-26-alpha-completion-audit/state.json`
- `week-26-alpha-completion-audit` records passing CI run `28867303505`
- release gate tests assert the alpha completion audit workflow evidence path

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- GitHub release publication
- deployment from a tag or release

## Week 26 Release Gate Tag Recovery Coverage

Implemented:

- release gate workflow evidence now covers the completed tag recovery packet
  workflow
- `week-26-release-tag-recovery` records passed main CI run `28861219727`
- `Release Tag Verification` run `28863312935` passed after the separately
  approved tag recovery
- release gate tests assert the tag recovery workflow evidence path

Not implemented:

- self-referential gating of this coverage change's own future CI run
- GitHub release publication
- deployment from a tag or release

## Week 26 Release Gate Publication Packet Coverage

Implemented:

- release gate workflow evidence now covers the completed publish and published
  verification packet workflows
- `week-26-release-publish-packet` records passing CI run `28864040079`
- `week-26-release-published-packet` records passing CI run `28864381009`
- release gate tests assert both publication packet workflow evidence paths

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- GitHub release publication
- deployment from a tag or release

## Week 26 Release Gate Status Packet Coverage

Implemented:

- release gate workflow evidence now covers the completed release status packet
  workflow
- `week-26-release-status-packet` records passing CI run `28865069916`
- release gate tests assert the status packet workflow evidence path

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- GitHub release publication
- deployment from a tag or release

## Week 26 Release Gate Shared Scan Coverage

Implemented:

- release gate workflow evidence now covers the completed release evidence
  shared brand scan workflow
- `week-26-release-evidence-shared-brand-scan` records passing CI run
  `28885961455`
- release gate tests assert the shared-scan workflow evidence path

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- GitHub release publication
- deployment from a tag or release

## Week 26 Release Gate Retention Cron Coverage

Implemented:

- release gate workflow evidence now covers the completed retention cleanup
  Cron Trigger workflow
- `week-26-retention-cleanup-cron-trigger` records passing CI run `28886935393`
- release gate tests assert the retention Cron workflow evidence path
- HON-51 live closeout deploys have now applied the Cron Trigger to staging and
  production, and `docs/release/retention-cron-evidence.md` records the
  scheduled event and synthetic cleanup deletion readback

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- GitHub release publication
- deployment from a tag or release

## Week 26 Release Gate Device Metadata Coverage

Implemented:

- release gate workflow evidence now covers the completed device metadata update
  API workflow
- `week-26-device-metadata-update-api` records passing CI run `28888487458`
- release gate tests assert the device metadata workflow evidence path

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- GitHub release publication
- deployment from a tag or release

## Week 26 Post-Alpha Ops Readiness Packet

Implemented:

- read-only operations readiness packet exposed as
  `pnpm ops:readiness:packet`
- aggregation of alpha release completion audit, email local preflight, and
  recorded Cloudflare/website/email/rollback evidence gates
- conservative requirement model that separates GitHub Release completion from
  Worker deploy, DNS, website, Email Routing, live smoke, and rollback evidence
- focused tests that model external release readback with fake `git`/`gh`
  commands and prove email tokens/destinations are not printed
- release and website/email docs that point operators to the packet before
  requesting post-release operations approvals

Not implemented:

- automatic GitHub release publication
- Worker deploy, DNS mutation, Email Routing configuration, or test email send
- live Worker smoke, website route, email routing, or rollback evidence
- release gate coverage for this workflow's future CI run

## Week 26 Release Gate Ops Readiness Coverage

Implemented:

- release gate workflow evidence now covers the completed post-alpha ops
  readiness packet workflow
- `week-26-post-alpha-ops-readiness-packet` records passed CI run
  `28889474503`
- release gate tests assert the ops readiness packet workflow evidence path

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- GitHub release publication
- Worker deploy, DNS mutation, Email Routing configuration, or test email send
- live Worker smoke, website route, email routing, or rollback evidence

## Week 26 Ops Evidence Templates

Implemented:

- post-alpha evidence placeholders for Worker live smoke, website live route,
  Email Routing, and operations rollback
- all new evidence files start with `Status: not_performed` so the ops readiness
  packet remains blocked until real approved operations are recorded
- release and website/email docs link the evidence files and explain when they
  can be marked `passed`
- ops readiness packet regression coverage proves placeholder files do not
  satisfy live Worker, website, Email Routing, or rollback requirements

Not implemented:

- Worker deploy, DNS mutation, Email Routing configuration, or test email send
- live Worker smoke, website route, email routing, or rollback evidence
- automatic promotion from `not_performed` to `passed`

## Week 26 Release Gate Ops Evidence Template Coverage

Implemented:

- release gate workflow evidence now covers the completed post-alpha ops
  evidence template workflow
- `week-26-ops-evidence-templates` records passed CI run `28890162723`
- release gate tests assert the ops evidence template workflow evidence path

Not implemented:

- self-referential gating of this coverage change's own future CI run
- automatic promotion from `not_performed` to `passed`
- Worker deploy, DNS mutation, Email Routing configuration, or test email send
- live Worker smoke, website route, email routing, or rollback evidence

## Week 26 Ops Readiness Release Approval Gate

Implemented:

- ops readiness packet now exposes the release publication approval gate
  inherited from the alpha completion audit
- `release.publicationGate` includes whether approval is required, the exact
  approval text, the publish command, the post-publication verification command,
  the release view command, and pending post-publication checks
- top-level ops readiness `commands` now includes `publishRelease` and
  `viewRelease` alongside `publishedVerification`
- focused tests prove draft-ready packets carry the exact approval text/command
  while published packets clear the publication approval requirement

Not implemented:

- automatic GitHub release publication
- tag creation, movement, deletion, or push
- Worker deploy, DNS mutation, Email Routing configuration, or test email send
- live Worker smoke, website route, email routing, or rollback evidence

## Week 26 Release Gate Ops Approval Coverage

Implemented:

- release gate workflow evidence now covers the completed ops readiness release
  approval gate workflow
- `week-26-ops-readiness-release-approval-gate` records passed CI run
  `28908143129`
- release gate tests assert the ops readiness release approval gate workflow
  evidence path
- `week-26-release-gate-ops-approval-coverage` records passed CI run
  `28908896648` while remaining outside release-gate self-reference

Not implemented:

- self-referential gating of this coverage workflow
- automatic GitHub release publication
- tag creation, movement, deletion, or push
- Worker deploy, DNS mutation, Email Routing configuration, or test email send
- live Worker smoke, website route, email routing, or rollback evidence

## Week 26 Release Published Packet

Implemented:

- read-only post-publication verification packet exposed as
  `pnpm release:published:packet`
- checks for local tag context, remote tag context, tag verification workflow
  evidence, release gate readiness, published prerelease state, target commit,
  and release-note body sections
- target commit defaults to the local `v0.1.0-alpha` tag commit so the packet
  remains valid after `main` advances
- focused tests covering published prerelease success, draft-state blocking,
  and strict failure when tag workflow evidence is absent
- tagging runbook instructions requiring the published packet after release
  publication

Not implemented:

- automatic GitHub release publication
- deployment from a tag or release

## Week 26 Release Publication, Worker Smoke, And Website Live Evidence

Implemented:

- `v0.1.0-alpha` GitHub Release was published as a prerelease on 2026-07-08
  after the draft release and tag verification gates passed
- `pnpm release:published:packet -- --strict`,
  `pnpm release:status:packet -- --strict`, and
  `pnpm release:completion:audit -- --strict` verified the published release
  target commit `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- production D1 migrations `0001`, `0002`, and `0003` were applied and
  rechecked with `wrangler d1 migrations list --env production --remote`
- staging and production API Workers were deployed from the release target
  commit after an initial `main` deploy was identified as the wrong source and
  corrected
- live HTTPS smoke passed for staging and production `/health`, `/healthz`,
  `/health/db`, `/api/config`, and synthetic prelogin deny behavior
- Worker deployment IDs, version IDs, candidate previous-version handles, and
  redacted live-smoke results are recorded in
  `docs/release/worker-live-smoke-evidence.md`
- `docs/release/cloudflare-resource-evidence.md`,
  `docs/release/publication-gate.md`, and
  `docs/release/ops-rollback-evidence.md` were updated with the non-secret
  publication, D1, deploy, and rollback-handle evidence
- `kazu-42/HonoWarden-website` PR #1 updated the public homepage to link to the
  v0.1.0-alpha GitHub Release and repository security policy without
  advertising unverified `security@honowarden.com` or `security.txt` metadata
- `kazu-42/HonoWarden-website` PR #2 restored verified public security contact
  metadata after Email Routing inbound smoke passed, and redacted private
  forwarding destinations from the website ops doc
- `honowarden.com` and `www.honowarden.com` were redeployed from website merge
  commit `97095812384b47e5a1798108d77d8224f75509f2` to Worker version
  `b408a4e2-4279-4a57-8172-698b1c77c6ab`
- website live smoke passed for apex and `www` root responses, `/health`,
  `/.well-known/security.txt`, `/security.txt` redirect behavior, release-note
  and security-policy links, and verified `mailto:security@honowarden.com`
  visibility
- `docs/release/website-live-evidence.md` now records website deployment,
  route, HTTPS smoke, link target, security-contact visibility, and rollback
  handle evidence
- Email Routing was enabled for `honowarden.com` on 2026-07-09 with local-only
  Cloudflare global API key auth stored outside the repository
- Cloudflare API readback reports Email Routing `enabled: true` and status
  `ready`
- one verified destination is configured, recorded only by the redacted hash tag
  `e732fc786e52`
- forwarding rules exist for `security`, `support`, `hello`, `admin`,
  `postmaster`, and `abuse`, with rule identifiers recorded in
  `docs/release/email-routing-evidence.md`
- DNS readback for `honowarden.com` now shows Cloudflare-managed MX records and
  SPF TXT for Email Routing
- inbound smoke passed for the six configured routes: Cloudflare Email Routing
  activity logs show `delivered`/`forward`, and the operator confirmed mailbox
  visibility without recording private mailbox contents
- `docs/release/ops-rollback-evidence.md` records Email Routing rule IDs and
  DNS record IDs for rollback handling
- API Worker rollback rehearsal is recorded as a non-mutating release-target
  dry-run plus live health-check decision: the previous Worker versions were
  rejected as unsafe rollback targets, and the approved alpha recovery strategy
  is to redeploy release target commit
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- Cloudflare deployment readback confirmed staging Worker version
  `bf0333dc-9efa-4001-aa31-20b3e10731c9`, production Worker version
  `72577dd9-c859-4673-b653-fbdd796f8f7d`, and website Worker version
  `b408a4e2-4279-4a57-8172-698b1c77c6ab` are still serving `100%` traffic
- rollback rehearsal health checks passed for staging and production
  `/health`, `/healthz`, `/health/db`, `/api/config`, and synthetic prelogin
  denial, with decision `continue`
- AI-driven inquiry inbox architecture is documented in
  `docs/operations/ai-inquiry-inbox.md`, including trust boundaries,
  Cloudflare Email Routing and Email Service responsibilities, D1/R2/Durable
  Object state boundaries, human approval rules, retention/redaction controls,
  and follow-up implementation split for `HON-24` through `HON-27`
- HON-24 metadata-only inquiry inbox ingestion implemented with Worker
  `email()` handler, `migrations/0011_inquiry_inbox.sql`, allowed mailbox
  enforcement, header/sender hashing, retention deadlines, optional verified
  forwarding through `HONOWARDEN_INQUIRY_FORWARD_TO`, and attachment rejection
  while storage is disabled
- Inquiry metadata is persisted before optional forwarding. If initial storage
  fails, the Email Worker fails before forwarding; if a post-forward status
  update fails, it logs a structured error and returns success to avoid
  duplicate forwarding on Cloudflare retry.

Not implemented:

- custom API domain routing for the alpha API Worker
- inquiry mailbox UI, body or attachment storage, AI triage, approved outbound
  replies, and Linear issue creation automation
- actual traffic-changing rollback execution, because the current live services
  passed health checks and no incident required rollback
- production secret writes, public registration enablement, or real vault-data
  dogfood

## Week 26 Access Token Key Rotation Support

Implemented:

- access-token signing accepts an explicit signing key and emits a JWT `kid`
  when `HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID` and
  `HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET` are configured
- access-token verification accepts an active key, previous keys, and legacy
  no-kid fallback while preserving the existing `HONOWARDEN_TOKEN_SECRET`
  refresh-token hash behavior
- unknown `kid` values fail closed and do not fall back to legacy verification
- partial active-key config, malformed previous-key JSON, and duplicate key ids
  fail closed with `server_misconfigured`
- token exchange signs both password-grant and refresh-grant access tokens with
  the active key when staged rotation is enabled
- authenticated routes accept tokens from previous keys and legacy no-kid tokens
  during the migration window
- `docs/operations/access-token-key-rotation.md` records staged rollout,
  verification, rollback, and evidence rules
- security docs and local operator env placeholders now distinguish
  access-token signing-key rotation from `HONOWARDEN_TOKEN_SECRET` rotation

Not implemented:

- live staging or production access-token signing-key rotation drill
- production secret rotation or forced re-login exercise
- asymmetric signing keys or JWKS publication

## Week 26 TOTP Wrapping-Secret Rotation Tooling

Implemented:

- `pnpm totp:rotate-secret` operator CLI
- dry-run-first readback of `user_totp` rows with secret-safe summary counts
- `rewrap` strategy for active and pending TOTP envelopes using local-only old
  and new wrapping secret env vars
- `force-reenrollment` strategy for cases where the old wrapping secret is
  unavailable or envelope recovery is rejected
- fail-closed handling for missing old/new rewrap secret inputs, corrupt active
  envelopes, and corrupt pending envelopes
- `--execute --confirm <database>:<strategy>` guard for mutating operations
- redacted execution evidence that does not print plaintext TOTP secrets,
  encrypted TOTP envelopes, or wrapping secret values
- `docs/operations/totp-secret-rotation.md` runbook covering dry-run, execute,
  rollback, partial failure, and evidence rules

Not implemented:

- live staging or production TOTP wrapping-secret rotation drill
- Wrangler runtime secret write automation
- user communication automation for force re-enrollment

## Week 26 Formal Secret Rotation Dry-Run

Implemented:

- `pnpm secret:rotation:drill` formal dry-run CLI
- credential-class matrix covering bootstrap token, refresh-token secret,
  access-token keyring, TOTP wrapping secret, Cloudflare scoped tokens,
  Cloudflare global-key break-glass fallback, GitHub, Linear, and Email Routing
  destinations
- dry-run JSON packet with configured/missing booleans only, never secret values
- blast-radius, live rotation shape, verification, rollback, and global
  redaction rules per credential class
- `docs/operations/secret-rotation-drill.md` runbook
- `docs/release/secret-rotation-drill-evidence.md` redacted dry-run evidence
- CI-backed operator test under `test/ops/secret-rotation-drill.test.ts`

Not implemented:

- live staging or production secret rotation
- Cloudflare account 2FA enforcement, stale-token retirement, or global-key
  mutation
- external communications drill

## Week 26 Scheduled Remote Backup Evidence

Implemented:

- `backup:evidence` command for checksum-verified, secret-safe executed backup
  evidence packets
- package-manager `--` separator handling for backup CLI commands used by docs
  and GitHub Actions
- `backup:schedule:packet` command for a reviewable scheduled remote backup
  contract
- scheduled GitHub Actions workflow under
  `.github/workflows/remote-backup.yml`
- daily `17 19 * * *` UTC and manual `workflow_dispatch` triggers for remote
  backup execution
- required repository secrets for the scheduled workflow:
  `CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
  `HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE`
- local operator env storage for derived R2 S3-compatible credentials and the
  backup archive passphrase in
  `~/.config/honowarden/cloudflare-scoped.env`
- encrypted GitHub Actions artifact retention of 7 days plus a documented
  35-day operator archive target
- live remote backup dry-run using R2 S3 listing, which confirmed the normal
  `attachments/` prefix was empty at the time of the drill
- live remote production D1 export and R2 backup execution using a temporary
  non-secret synthetic R2 object
- `docs/release/remote-backup-evidence.md` with non-secret manifest id, D1
  checksum/size, R2 object count/digest/size, restore verification, cleanup
  readback, failure handling, and remaining limitations
- local fresh-target restore from the remote backup using a separate
  `--persist-to` target, with restored D1 table count and R2 checksum match
  verified
- cleanup readback confirming the temporary production R2 drill object no
  longer exists
- focused tests for the scheduled backup packet, remote backup workflow, backup
  evidence command, and backup CLI separator handling

Not implemented:

- first post-merge GitHub Actions scheduled or manual workflow run, because the
  new workflow is not available on `main` until this PR merges
- remote restore into a disposable Cloudflare D1/R2 target
- long-term external archive copy automation beyond the encrypted GitHub
  artifact and documented operator retention target

## Official Desktop And Login-With-Device Live Evidence

Implemented and verified with synthetic staging data on 2026-07-12:

- official Desktop `2026.6.1` clean-profile self-hosted password login,
  successful sync, and empty-vault rendering
- official browser extension `2026.6.1` login-with-device request creation,
  Desktop notification and approval, one-time auth-request token exchange, and
  empty-vault rendering
- trailing-slash compatibility for the official extension's
  `POST /api/auth-requests/` request
- sync user-decryption compatibility through the official
  `masterKeyEncryptedUserKey` field
- owner-scoped pending notification type `15` through the authenticated
  SignalR `ReceiveMessage` target
- request-scoped anonymous SignalR WebSocket validation and response type `16`
  delivery through the official `AuthRequestResponseRecieved` target
- exact fingerprint equality verification without recording the phrase
- redacted empty-vault screenshots and status-class evidence in
  `docs/release/login-with-device-live-client-evidence.md`
- promotion of the Desktop `2026.6.1` compatibility row from `fixture_only` to
  narrow `live_smoke`

Not implemented or not yet verified:

- Desktop item create/update/delete and logout/login persistence lifecycle
- automatic timed polling in the current official extension when anonymous
  response notification delivery is unavailable
- superseding older pending requests created by repeated resend attempts
- production login-with-device enablement or any real-vault-data run

## Organizations Slice 1 Foundation

Implemented:

- forward-only migration `0014_organizations.sql` with organization,
  membership, collection, collection-access, and collection-cipher join tables
- nullable `organization_id` and opaque `cipher_key` columns on `ciphers`, so
  existing personal-vault records retain their prior ownership semantics
- authenticated organization creation with a confirmed owner membership and a
  managed default collection created in one D1 batch
- confirmed-member-only organization lookup with existence-obscuring 404
  responses for unknown organizations and non-members
- confirmed membership projection into sync and account profile responses,
  including each member's own wrapped organization key
- accessible collection projection into sync with explicit same-organization
  join predicates
- a reusable single-cipher access resolver for personal ownership and confirmed
  managed-collection organization access

Not implemented in this slice:

- organization membership mutation, invitations, or role administration
- organization collection CRUD
- organization cipher sharing or collection assignment APIs
- organization policy mutation or enforcement
