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
- conservative `fixture_only` verification level for all rows
- explicit known issues per client surface
- compatibility matrix validation in `pnpm compat:test`

Not implemented:

- refresh token reuse alerting
- device list and device metadata update APIs
- live client compatibility evidence
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

- auth-attempt retention cleanup job
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
- challenge retention cleanup job
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

The project remains pre-alpha and must not be used to store real secrets.
