# Current State

Last updated: 2026-07-06

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
- CORS for same-origin and official extension-style origins
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
- device list and device metadata update APIs
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
- revoke-all-sessions route or revoke-all re-auth guard
- TOTP disable/change route
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

- route-executed fixture replay for every compatibility fixture
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
- live official-client matrix promotion

The project remains pre-alpha and must not be used to store real secrets.

## Linear Tracking Setup

Implemented:

- Linear seed validation script exposed as `pnpm linear:seed`
- HonoWarden Linear seed updated with the current Week 25 completion status
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

The Linear seed remains the source of truth until a connector or browser session
is authenticated to the `honowarden` workspace.

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

## Week 26 Retention Cleanup

Implemented:

- bounded inline cleanup on the password-grant token path
- stale `auth_attempts` cleanup by retention threshold
- stale, unlocked `auth_failure_buckets` cleanup by retention threshold
- expired or consumed `totp_challenges` cleanup
- idempotent repository cleanup functions with row caps
- retention cleanup runbook under `docs/operations/retention-cleanup.md`
- tests for bounded and idempotent auth-defense and TOTP challenge cleanup

Not implemented:

- Cloudflare Cron Trigger for cleanup when password-grant traffic is absent
- cleanup metrics or alerting
- dedicated cleanup-only indexes for larger production datasets

## Week 26 Unsupported Surface Guards

Implemented:

- explicit `501` JSON response for `/api/organizations` and child paths
- explicit `501` JSON response for `/api/sends` and child paths
- request ID preservation on unsupported feature responses
- route test coverage proving these paths do not fall through to generic `404`

Not implemented:

- organization or shared-vault functionality
- public file-sharing functionality
