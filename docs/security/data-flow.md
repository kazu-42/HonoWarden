# Security Data Flow

Last reviewed: 2026-07-19.

This document describes where sensitive data enters, moves, and persists.

## Boundaries

```text
client applications
  -> Cloudflare Worker / Hono routes
  -> D1 relational state
  -> R2 encrypted objects, when object storage is needed
  -> Cloudflare platform logs, only when audit logging is enabled

operator CLI
  -> local backup directory
  -> Wrangler D1/R2 commands
  -> Wrangler D1 account lifecycle commands
```

## Account Bootstrap

1. Operator sends `POST /api/accounts/bootstrap`.
2. Worker requires `HONOWARDEN_BOOTSTRAP_ENABLED=true`.
3. Worker compares the bootstrap token from the request header with
   `HONOWARDEN_BOOTSTRAP_TOKEN`.
4. Request email must be in `HONOWARDEN_ALLOWED_EMAILS`.
5. D1 stores identity, KDF settings, master password hash, user key, private key,
   and security stamp.
6. Audit logs record success only when audit logging is enabled.

Security notes:

- bootstrap is default-off in Wrangler vars
- public registration routes return explicit disabled errors
- real bootstrap tokens must be Wrangler secrets or local environment values

## Password Grant

1. Client posts form data to `/identity/connect/token`.
2. Worker requires device information.
3. Worker checks IP and account failure buckets.
4. Worker looks up the normalized email in D1.
5. Missing, disabled, locked, or wrong-password accounts return generic
   invalid-grant errors.
6. TOTP-enabled users receive a device-bound challenge before token issuance.
7. Successful password grant resets login defenses, inserts a device row, stores
   a secret-bound refresh-token hash, and returns an access token plus refresh
   token. If an active access-token signing key is configured, the access token
   is signed with that key and carries its JWT `kid`; otherwise it uses the
   legacy no-kid token secret path.

Data stored:

- access token is not stored server-side
- refresh token plaintext is not stored in D1
- D1 stores refresh-token hash, device id, expiry, and revocation state

## Password Verification And Change

1. An authenticated client posts its current client-derived authentication hash
   to `POST /api/accounts/verify-password` or as the current proof in
   `POST /api/accounts/password`.
2. Worker validates the bearer token and current security stamp, then applies
   the existing IP/account credential-proof defenses.
3. Verify-password performs a constant-time hash comparison and returns only an
   empty `masterPasswordPolicy` projection. It does not mutate credentials or
   emit credential material.
4. Password change accepts pinned structured, transitional legacy, or matching
   dual representations. Structured authentication and unlock data must agree
   on KDF and salt, and those values must match the stored account generation.
5. One generation-guarded D1 batch replaces only the authentication hash and
   opaque wrapped user key, advances the security stamp and revision, revokes
   all active device and refresh-token sessions, supersedes active auth
   requests, and inserts the required `account.password.change` audit row.
6. Folder, cipher, attachment, email, and KDF columns are outside that batch and
   remain unchanged. A stale generation or any failed batch statement leaves
   the old credential generation and sessions unchanged.
7. After commit, Worker invalidates authenticated Durable Object notification
   sessions with the new generation. This socket cleanup is outside D1's atomic
   boundary: failure returns an explicit `session_revocation_incomplete` 503,
   while the password and D1 session revocation remain committed.

Secret-handling invariants:

- HonoWarden receives client-derived authentication hashes and opaque encrypted
  user keys, not plaintext master passwords or plaintext vault keys.
- non-empty password hints are rejected before proof or mutation because there
  is no persisted hint contract
- audit and logs exclude current/new hashes, wrapped user keys, access tokens,
  refresh tokens, request bodies, and encrypted vault payloads

## KDF Change

1. The default-off KDF writer gate must be explicitly enabled. Reader paths stay
   active while disabled so existing Argon2id generations remain usable.
2. An authenticated client derives a complete new authentication/unlock
   generation locally and posts it to `POST /api/accounts/kdf` together with the
   old client-derived authentication hash as proof.
3. Worker requires matching authentication and unlock KDF settings, the same
   unchanged normalized-email salt, and one supported KDF configuration within
   the pinned server/client intersection. In particular, Argon2id memory starts
   at 16 MiB because pinned clients reject the server-only 15 MiB boundary.
4. The credential-proof defense and constant-time old-hash comparison run before
   mutation. Unknown or structurally invalid stored KDF values fail at the auth
   repository read boundary and cannot become a PBKDF2 fallback.
5. One guarded D1 batch replaces authentication hash, opaque wrapped user key,
   KDF algorithm and parameters, security stamp, and revision; revokes active
   device and refresh sessions; supersedes active auth requests; and persists
   `account.kdf.change`.
6. Prelogin, password and refresh token responses, profile, and sync all project
   the same stored generation. One read-only D1 snapshot returns the exact
   prelogin target plus the grouped client-readable stored KDF population. A known
   account receives its exact validated generation; an unknown allowed account
   receives a domain-separated, email-stable HMAC selection from that
   population weighted by account count. This includes readable legacy tuples
   and emits only valid resource profiles already stored. Unrelated malformed or
   client-unreadable rows are excluded so one corrupt account cannot fail every
   allowed prelogin; an invalid exact target still fails closed. An empty valid
   population falls back to bootstrap PBKDF2 `600000`. The HMAC is keyed by
   `HONOWARDEN_TOKEN_SECRET`, and a missing secret fails before D1.
7. A missing Durable Object binding fails before mutation. Once D1 commits,
   Durable Object cleanup is forward-only: transport failure is logged as
   `account_notification_session_invalidation_failed`, but the route still
   acknowledges success so the official client persists the matching local KDF.
   Recovery never restores the old KDF generation.

## Refresh Grant

1. Client posts `grant_type=refresh_token`.
2. Worker hashes the presented token with `HONOWARDEN_TOKEN_SECRET`.
3. D1 session row must exist, be unrevoked, be unexpired, belong to an active
   user, and belong to an active device.
4. Worker revokes the current token and inserts a child refresh token.
5. Worker issues the new access token with the active access-token signing key
   when configured, while refresh-token hashing remains bound to
   `HONOWARDEN_TOKEN_SECRET`.
6. Reuse detection invalidates the session and emits an audit event when
   enabled.

## Sync And Vault CRUD

1. Client sends bearer access token to `/api/sync` or vault mutation routes.
2. Worker verifies token signature, expiry, subject, device claim, and security
   stamp. JWT `kid` values must match the active or previous access-token
   keyring; legacy no-kid tokens are accepted only through the configured
   fallback window.
3. Worker loads the active user and rejects disabled users.
4. Folder, cipher, and attachment repository calls bind `auth.user.id`.
5. Cipher and folder payloads remain opaque encrypted strings to the server.
6. Attachment uploads store opaque encrypted bytes in R2 under
   `attachments/<uuid>` object keys and store owner-scoped metadata in D1.
7. Attachment download and delete first resolve D1 metadata by authenticated
   `user_id`, `cipher_id`, and attachment `id`; R2 object keys are never exposed
   in API responses.

Owner-scope invariant:

- a caller can only list, update, delete, restore, or permanently delete rows
  whose `user_id` equals the authenticated user id
- cipher create/update with a folder id first verifies folder ownership
- attachment metadata must match the authenticated user and parent cipher before
  any R2 object read or delete

## Account Lifecycle Operator CLI

1. Operator runs `pnpm account:lifecycle` in dry-run mode first.
2. The CLI builds a D1 readback command, guarded lifecycle mutation, post-readback
   command, rollback command, and secret-safe audit packet.
3. `--execute` requires exact `--confirm <target>` matching the normalized email
   or user id.
4. Disable sets `users.disabled_at`, `updated_at`, and `revision_date` only when
   the account is active.
5. Enable clears `users.disabled_at` and updates account revision metadata only
   when the account is disabled.

The CLI does not query, print, or mutate vault payloads, encryption keys,
password hashes, token hashes, device rows, or cipher/folder rows.

## Device List Read

1. Client sends bearer access token to `GET /api/devices` or
   `GET /api/devices/identifier/:identifier`.
2. Worker verifies token signature, expiry, subject, device claim, and security
   stamp.
3. Worker loads the active user, reads the user-scoped device rows from D1, and
   applies identifier filtering for the lookup-by-identifier route.
4. The response is read-only device metadata; these routes do not persist or mutate
   server-side device state.

## Known-Device Preflight

1. Anonymous client sends `GET /api/devices/knowndevice`.
2. Request must include:
   - `X-Request-Email`: base64url-encoded UTF-8 email
   - `X-Device-Identifier`: client device identifier
3. Missing or malformed header values are rejected as `invalid_request`.
4. Worker resolves the decoded email and device identifier to a known-device
   boolean.
5. Response body is a bare boolean: `true` when known, `false` otherwise.
6. Route completes without mutating device metadata, trust relationships, or keys.

## TOTP

1. Recent password authentication is required for TOTP setup, setup verify, and
   disable, plus TOTP change start and change verify.
2. Setup rejects accounts that already have TOTP enabled; change is a separate
   route that verifies the current TOTP code before creating a pending
   replacement secret.
3. Initial setup creates a generated base32 secret and stores an AES-GCM
   envelope in D1.
4. Verify checks the presented code and records the accepted timestep to prevent
   replay.
5. Disable deletes the enabled TOTP setup row for the account, removing stored
   setup secret material and replay metadata (for example, last accepted
   timestep). The account profile then reports TOTP as disabled through the
   auth lookup left join.
6. Change stores the replacement secret in `pending_encrypted_secret` while the
   current TOTP secret remains enabled. Change verify promotes the pending
   secret, clears pending state, and records the new accepted timestep.
7. Login challenge records a hashed, expiring, single-use challenge bound to the
   device identifier.

Secrets:

- plaintext setup secret is returned only during setup
- encrypted setup secret is wrapped by `HONOWARDEN_TOTP_SECRET`
- pending TOTP change secret is wrapped by `HONOWARDEN_TOTP_SECRET`
- operator TOTP wrapping-secret rotation can rewrap both active and pending
  envelopes in memory without logging plaintext or encrypted envelopes
- challenge plaintext is not stored

## Audit Logs

Most audit JSON lines and D1 `audit_events` rows are emitted only when
`HONOWARDEN_AUDIT_LOGS=true`. Required credential-generation audit rows are
persisted atomically with their mutation regardless of that optional setting.

Current event coverage:

- bootstrap success
- password change, account-wide token/device revocation, prior-stamp
  invalidation, and active auth-request supersession
- security-stamp generation rotation, account-wide token/device revocation,
  prior-stamp invalidation of authenticated notification sockets, and
  invalidation of outstanding login-with-device authorizations; ordinary
  account revisions that retain the stamp preserve notification sessions
- password-grant failures that reach credential validation
- refresh-token reuse
- user backup export success and database-failure outcomes
- folder create, update, and delete
- cipher create, update, trash, restore, and permanent delete
- attachment upload and delete
- device revoke success and not-found outcomes
- revoke-all-other-sessions success
- TOTP disable success and not-enabled outcomes

Events must not include passwords, token plaintext, token hashes, TOTP secrets,
plaintext IP addresses, encrypted payloads, request bodies, or response bodies.
The persisted row stores explicit metadata columns and sanitized `context_json`
rather than a full HTTP payload.

## User Backup Export API

1. Client sends `POST /api/accounts/export` with a bearer access token.
2. Worker verifies the access token and then requires recent password
   authentication: `authMethod=password` and token age within five minutes.
3. Worker loads folders, ciphers, and cipher attachment metadata using the same
   owner-scoped repository helpers as sync.
4. The response disables caching and returns `object: "backupExport"` with
   account metadata, folders, ciphers, and attachment metadata.
5. The response excludes master password hashes, refresh-token rows, TOTP setup
   secrets, internal R2 object keys, raw R2 object bodies, and cross-user rows.
6. When audit logging is enabled, Worker logs and D1 audit persistence emit
   `backup.export` with count-only context.

The export still contains encrypted vault data and account key material already
available to authenticated clients. Treat downloaded exports as sensitive user
data.

## Backup And Restore

1. Operator runs the backup CLI.
2. Dry-run is default.
3. Remote R2 backup can discover object keys through the S3-compatible
   `ListObjectsV2` API without downloading object bodies during dry-run.
4. Executed export writes D1 SQL, optional R2 object files, and manifest data.
   Attachment backups require both `cipher_attachments` metadata in D1 and the
   corresponding `attachments/` R2 objects.
5. Restore validates manifest schema, deterministic R2 key/file mapping,
   relative paths, R2 path containment, and SHA-256 hashes.
6. Restore execution requires `--confirm-fresh-target`.
7. CLI stdout includes a secret-safe audit packet with action, result status,
   and manifest SHA-256 id only.

Backup directories remain sensitive even when vault payloads are encrypted.
