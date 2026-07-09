# Current State

Last updated: 2026-07-08

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
- device upsert before refresh token persistence
- stable invalid grant, invalid request, misconfigured, and database unavailable responses

## Week 7 Increment

Implemented:

- `refresh_token` grant support on `POST /identity/connect/token`
- refresh token lookup by secret-bound hash
- refresh token rotation with old-token revocation and child token insertion
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
- `PUT /api/ciphers/:id`
- `DELETE /api/ciphers/:id`
- `PUT /api/ciphers/:id/restore`
- `DELETE /api/ciphers/:id/delete`
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
- conservative `fixture_only` verification level for all rows at matrix creation
- explicit known issues per client surface
- compatibility matrix validation in `pnpm compat:test`

Not implemented:

- refresh token reuse alerting
- live client compatibility evidence for the tracked versions
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
- operator-facing rate-limit metrics or alerts
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

Not implemented:

- backup export route or backup-export re-auth guard
- live client re-auth evidence

The project remains pre-alpha and must not be used to store real secrets.

## Week 20 Increment

Implemented:

- operator backup/restore CLI wrapper under `scripts/honowarden-backup.mjs`
- `pnpm backup:export` and `pnpm backup:restore`
- dry-run default behavior for export and restore planning
- D1 export planning through `wrangler d1 export`
- D1 restore planning through `wrangler d1 execute --file`
- R2 object get/put planning from an explicit object key list
- backup manifest with schema version, source resource names, object list, planned commands, and restore hint
- SHA-256 file hashes added to the manifest after executed export
- restore execution preflight for manifest schema, safe relative paths, required checksums, and checksum matches
- restore `--execute` guard requiring `--confirm-fresh-target`
- local-only `--persist-to` handling for commands that support it
- backup/restore runbook under `docs/operations/backup-restore.md`
- tests for export planning, restore planning, flag scoping, path traversal rejection, fresh-target confirmation, and checksum mismatch rejection
- Week 20 dynamic workflow artifacts

Not implemented:

- automatic R2 object listing
- scheduled backup job
- remote production backup execution
- live restore drill evidence
- server-side public backup API

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
- audit events for successful and not-found device revoke attempts
- docs for audit event shape, implemented event names, non-goals, and operator notes
- tests proving audit builder sanitization and route-level opt-in event emission

Not implemented:

- D1 audit-event persistence
- external log sink integration
- audit events for every vault CRUD route
- live log-retention verification
- automated backup audit ingestion beyond the Week 20 runbook evidence

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

- live two-user dogfood evidence
- live disabled-user lifecycle operation
- shared vault or Organization isolation
- production admin tooling for disabling users

## Week 24 Increment

Implemented:

- security review index under `docs/security/review-index.md`
- threat model with assets, actors, trust boundaries, STRIDE summary, attack surface, and high-risk abuse paths
- security data-flow document for bootstrap, auth, sync, TOTP, audit logs, and backup/restore
- authentication state machine for account, password grant, refresh grant, access-token verification, and device revoke states
- secrets inventory for runtime secrets, non-secret runtime config, sensitive stored data, and rotation notes
- known limitations document preserving pre-alpha and no-independent-audit warnings
- dependency audit evidence with package manager output and lockfile SHA-256
- `SECURITY.md` link to the security review materials
- CI-backed security docs test under `test/security-docs.test.ts`
- dependency audit evidence with no known vulnerabilities found on 2026-07-06
- Week 24 dynamic workflow artifacts

Not implemented:

- independent security audit
- external penetration test
- Cloudflare account access-control review
- incident response runbook
- secret rotation drill

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
  token or destination values
- Email Routing preflight tests under `test/ops/email-preflight.test.ts`
- ignored local Email Routing inputs are now configured for account id, zone id,
  and all six destination variables; `CLOUDFLARE_API_TOKEN` remains missing

Not implemented:

- live Linear API writes with a HonoWarden workspace key
- Cloudflare DNS or Email Routing writes through API tokens

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

- none after CLI live-client evidence was recorded locally

Not implemented:

- real Cloudflare staging deploy
- deployed Worker HTTP health smoke
- non-CLI live client evidence

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

- none after CLI live-client evidence was recorded locally

Not implemented:

- Worker deploy
- secret writes
- route writes
- production migration apply
- deployed Worker HTTP health smoke
- non-CLI live client evidence

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

Not implemented:

- browser extension live evidence
- desktop live evidence
- mobile live evidence
- live TOTP login evidence
- live item mutation evidence

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

Not implemented:

- live Cloudflare deploy applying the Cron Trigger
- Cron Events monitoring evidence
- cleanup metrics or alerting
- dedicated cleanup-only indexes for larger production datasets

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

## Week 26 Unsupported Surface Guards

Implemented:

- explicit `501` JSON response for `/api/organizations` and child paths
- explicit `501` JSON response for `/api/sends` and child paths
- explicit `501` JSON response for collection, emergency-access, attachment,
  and cipher-attachment paths
- request ID preservation on unsupported feature responses
- route test coverage proving these paths do not fall through to generic `404`

Not implemented:

- organization or shared-vault functionality
- public file-sharing functionality
- collection or emergency-access functionality
- attachment object storage, download, or mutation functionality

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

- live client evidence for revoke-all-other-sessions
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
- owner-scoped active-device lookup by stable device ID or device identifier
- required encrypted user/public/private key payload validation with
  upper-camel and lower-camel request aliases
- opaque encrypted key storage without server-side plaintext access
- `isTrusted` response derivation only when encrypted user, public, and private
  key payloads are all present
- response shape returns encrypted user and public keys but never returns the
  encrypted private key
- stable `400`, `401`, `404`, and `503` JSON responses
- compatibility fixture flow `device_keys_update` under
  `compat/fixtures/devices/keys-update-success.json`

Not implemented:

- bulk `POST /api/devices/update-trust` trusted-device rotation workflow
- login-with-device approval, push notification, or pending auth-request flows
- live client evidence for encrypted device key update

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
- compatibility fixture flow `account_profile` under
  `compat/fixtures/accounts/profile-success.json`

Not implemented:

- account profile mutation APIs
- email change, password change, or account deletion flows
- live client evidence for the account profile endpoint

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
- list responses use `object: "list"` with `data` and `continuationToken: null`
- compatibility fixture flow `direct_read` for folder and cipher list/get
  responses

Not implemented:

- paginated folder or cipher list responses
- direct attachment read APIs
- collection-scoped reads
- live client evidence for direct folder or cipher read endpoints

## Week 26 Metadata Read APIs

Implemented:

- authenticated `GET /api/policies`
- authenticated `GET /api/policies/new`
- authenticated `GET /api/domains`
- authenticated `GET /api/settings/domains`
- policy endpoints return empty list responses for the alpha personal-vault
  scope
- domain endpoints reuse the same empty equivalent-domain metadata as `/api/sync`
- compatibility fixture flow `metadata_read` for policy and domain responses

Not implemented:

- policy management or organization policy enforcement
- custom equivalent-domain configuration
- live client evidence for metadata read endpoints

## Week 26 Collection Metadata Read API

Implemented:

- authenticated `GET /api/collections`
- authenticated `GET /api/collections/:id`
- collection list returns an empty list response for the alpha personal-vault
  scope
- collection lookup returns stable `collection_not_found`
- collection mutation routes remain explicit `unsupported_feature` responses
- compatibility fixture coverage under the `metadata_read` flow

Not implemented:

- collection creation, update, deletion, or assignment behavior
- organization-scoped collections
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
- cipher trash route semantics now align with the compatibility fixture:
  `DELETE /api/ciphers/:id` trashes and `DELETE /api/ciphers/:id/delete`
  permanently deletes
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

Not implemented:

- self-referential gating of this coverage workflow's own future CI run
- live Cloudflare deploy applying the Cron Trigger
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
- `honowarden.com` and `www.honowarden.com` were deployed from website merge
  commit `36b8171f7afd55bf306e5482cca454a0b3822a39` to Worker version
  `eef4ab71-d6e8-401f-93c3-27e7bd2bcd91`
- website live smoke passed for apex and `www` root responses, `/health`, link
  assertions, negative security-mailbox assertions, and inactive
  `security.txt` routes
- `docs/release/website-live-evidence.md` now records website deployment,
  route, HTTPS smoke, link target, security-contact visibility, and rollback
  handle evidence
- Email Routing readback on 2026-07-08 confirmed Cloudflare OAuth is logged into
  account `gHive`, but Wrangler still reports missing `email_routing:write` and
  `email_sending:write`; settings, rules, and destination-address API calls
  fail with Cloudflare authentication error `10000`
- DNS readback for `honowarden.com` shows Cloudflare nameservers and website
  A/AAAA records, but no MX or apex TXT records yet

Not implemented:

- custom API domain routing for the alpha API Worker
- Email Routing live route creation and inbound delivery evidence in
  `docs/release/email-routing-evidence.md`
- verified safe rollback target selection for the API Worker
- rollback rehearsal or rollback execution
- production secret writes, public registration enablement, or real vault-data
  dogfood
