# Authentication State Machine

Last reviewed: 2026-07-19.

This document records the server-side authentication and session states that
must remain stable for alpha.

## Account States

| State              | Entered By                     | Allowed Actions                                        | Rejected Actions                                 |
| ------------------ | ------------------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| no account         | default                        | prelogin metadata only                                 | password grant, sync, refresh                    |
| active             | bootstrap                      | password grant, refresh, sync, vault CRUD              | none by account state                            |
| temporarily locked | failed password attempts       | prelogin, eventual retry                               | password grant until lock expires                |
| TOTP setup pending | authenticated setup            | setup verify                                           | login without valid challenge if TOTP is enabled |
| TOTP enabled       | setup verify                   | password grant followed by TOTP challenge verification | token issuance without TOTP code                 |
| disabled           | account lifecycle operator CLI | prelogin metadata only                                 | password grant, refresh grant, sync, vault CRUD  |

Prelogin metadata is not authentication or authorization. Account disable is a
reversible operator state and does not alter the account salt or KDF generation.
The exact KDF target and its contribution to the stored decoy population remain
stable while disabled; replacing either with an unknown-account decoy would
make the disable transition observable through this anonymous endpoint. Every
grant and authenticated-session path still rejects the disabled account with
the same generic boundary used for invalid credentials.

## Password Grant

```text
request
  -> refresh-token secret configured?
  -> access-token signer config valid?
  -> form grant_type=password?
  -> device information present?
  -> IP/account lockout open?
  -> active user found?
  -> password hash matches?
  -> TOTP required?
       yes -> issue challenge or verify challenge
       no  -> issue access token and refresh token
```

Failure invariants:

- missing token secret or malformed access-token keyring config returns server
  misconfigured
- missing device metadata returns invalid request
- unknown, disabled, locked, or wrong-password account returns generic
  invalid-grant wording
- login defense failures are recorded without plaintext client address storage

## Password Verification And Change

```text
authenticated bearer token at current security stamp
  -> current authentication-hash proof is well formed?
  -> credential-proof defense allows attempt?
  -> current hash matches in constant time?
  -> verify only?
       yes -> return empty password policy without credential mutation
       no  -> structured/legacy generation is internally consistent?
           -> structured salt and KDF equal stored generation?
           -> guarded D1 batch changes hash + wrapped key + stamp + revision,
              revokes all sessions/auth requests, and persists mandatory audit
           -> invalidate Durable Object notification sessions
```

Success invariants:

- KDF, normalized-email salt, account identity, and encrypted vault rows remain
  unchanged
- old access tokens fail because the security stamp changed
- old refresh tokens and devices are revoked, and old password grants fail
- the new client-derived hash can log in and the new opaque wrapped user key can
  unlock the unchanged encrypted vault through normal client cryptography

Failure invariants:

- malformed, oversized, mixed-alias, non-empty-hint, KDF-drift, salt-drift, and
  wrong-current-proof requests do not mutate the credential generation
- a stale generation returns `revision_conflict`; the guarded D1 batch leaves
  credentials, sessions, auth requests, and audit rows unchanged
- a failed D1 batch statement rolls back the entire mutation
- Durable Object cleanup is post-commit; its failure returns
  `session_revocation_incomplete` while the new D1 credential generation stays
  authoritative

## KDF Change

```text
explicit KDF writer rollout flag enabled
  -> authenticated bearer token at current security stamp
  -> new authentication/unlock data agree on salt and KDF?
  -> unchanged normalized-email salt and bounded PBKDF2/Argon2id settings?
  -> credential-proof defense allows attempt and old hash matches?
  -> guarded D1 batch changes hash + wrapped key + KDF + stamp + revision,
     revokes all sessions/auth requests, and persists mandatory audit
  -> schedule Durable Object notification-session invalidation with waitUntil
```

Success invariants:

- account identity, normalized-email salt, and encrypted vault rows are unchanged
- every outward KDF projection reads the same committed generation
- old access/refresh sessions and old-KDF authentication hashes fail
- the new client-derived hash logs in with the new wrapped user key and KDF
- after D1 commit, the client receives success without waiting for notification
  socket cleanup, even if cleanup stalls or fails, so its local KDF cannot
  remain on the revoked generation

Failure invariants:

- a disabled writer returns unsupported before authentication or D1 access
- out-of-range, missing, unknown, mixed, or salt-drifted data is state-free
- a stale old generation returns `revision_conflict` without partial revocation
- every failed D1 batch statement rolls back user, session, auth-request, and
  audit changes together
- a missing notification binding fails before mutation; post-commit transport
  latency cannot delay success, while failure is logged, remains forward-only,
  and never changes the response or restores an old KDF

## Account Key Initialization

```text
explicit account-key route flag enabled
  -> authenticated active user at current security stamp
  -> non-empty wrapped user key exists?
  -> strict complete bounded V1 public/wrapped-private payload?
  -> stored state?
       both null -> reserve mandatory audit from exact source generation,
                    then guarded D1 update pair + account revision
       exact pair -> return success without mutation
       different or partial -> reject without disclosure or replacement
```

Success invariants:

- first initialization writes one pair and one required redacted audit row
- account revision advances while security stamp and every session remain valid
- an exact concurrent retry returns the committed pair without a second audit
- password, refresh-token, profile, sync, backup, and dedicated read paths
  expose the same complete legacy and nested projection

Failure invariants:

- a disabled flag returns unsupported before authentication or D1 access,
  including when the optional global request quota is enabled
- malformed, unknown, oversized, partial, or V2 input is state-free
- a missing or blank wrapped user key fails before initialization and no
  complete account-key projection is returned
- bootstrap rejects a partial pair or a complete pair without a wrapped user
  key before account insertion
- stale stamp/revision, disabled user, cross-user id, partial stored state, or a
  different existing pair cannot overwrite account keys
- audit reservation or user-update failure rolls the whole D1 batch back
- a partial stored pair cannot be returned or consume a TOTP challenge, create
  an auth session, or rotate a refresh token
- route catches report partial or otherwise invalid projection state through a
  redacted request-correlated signal before returning generic 503
- profile updates and backup success audits occur only after the same projection
  validates, so a projection failure leaves neither side effect
- this initializer never rotates a security stamp; true replacement belongs to
  a separate state machine with data-rewrap and session-revocation rules

## TOTP Setup

```text
recent-password-authenticated user
  -> TOTP already enabled?
       yes -> reject setup reuse
       no  -> generate pending setup secret
  -> wrapping secret configured?
  -> store encrypted pending setup
```

Failure invariants:

- setup reuse is rejected while TOTP is already enabled
- enabled TOTP rows must not be overwritten into pending state by setup

## TOTP Change

```text
recent-password-authenticated user
  -> active TOTP setup exists?
  -> wrapping secret configured?
  -> current TOTP code verifies and records accepted step?
  -> generate pending replacement secret without disabling current TOTP
  -> pending replacement code verifies?
  -> promote pending secret, clear pending state, record new accepted step
```

Failure invariants:

- change start and change verify both require recent password authentication
- current TOTP code replay fails closed through accepted-step recording
- pending change verify fails closed when no pending replacement secret remains
- account profile remains TOTP-enabled while a replacement secret is pending

## Refresh Grant

```text
request
  -> refresh-token secret configured?
  -> access-token signer config valid?
  -> form grant_type=refresh_token?
  -> refresh token hash lookup succeeds?
  -> token is not revoked?
  -> user is active?
  -> device is active?
  -> token is not expired?
  -> rotate token and issue password-independent access token
```

Failure invariants:

- revoked token reuse invalidates the device session
- disabled users cannot refresh
- revoked devices cannot refresh
- expired or unknown tokens return generic invalid-grant wording

Retention note: cleanup only deletes refresh-token rows that have been expired
for at least 30 days. Active and revoked-but-unexpired rows remain available for
lookup, preserving revoked-token reuse detection and device-session invalidation
for the token's entire validity period.

## Access Token Verification

```text
bearer token
  -> access-token verifier config valid?
  -> if JWT header has kid, matching active or previous key exists?
  -> if JWT header has no kid, legacy no-kid fallback is allowed?
  -> HMAC signature valid?
  -> exp still valid?
  -> user exists?
  -> user not disabled?
  -> security stamp still matches?
  -> authenticated request context
```

Recent-auth invariant:

- tokens with unknown `kid` fail closed and do not fall back to the legacy
  no-kid secret
- sensitive TOTP setup routes require `authMethod=password`
- TOTP disable requires `authMethod=password`
- revoke-all-other-sessions requires `authMethod=password`
- token age must be within the recent password-auth window
- refresh-auth and legacy claimless tokens are rejected for recent-auth routes

## TOTP Disable

```text
recent-password-authenticated user
  -> user has TOTP enabled?
  -> delete enabled TOTP setup row
  -> left-joined account state reports TOTP disabled
  -> return stable TOTP response
```

Failure invariants:

- `reauth_required` for stale password-auth, refresh-auth, and claimless tokens
- missing or already-disabled TOTP setup returns a stable invalid request
- successful disable removes stored setup secret and replay marker state

## Device Revoke

```text
authenticated user
  -> target device id parsed
  -> target is not current device
  -> active target belongs to user
  -> revoke device and active refresh tokens
```

Failure invariants:

- current-device revoke through this route is forbidden
- missing, already revoked, or cross-user devices return not found
- successful and not-found outcomes are auditable when audit logging is enabled

## Login With Device

ADR 0008 defines the implemented contract. Runtime routes and Durable Object
notifications are enabled for synthetic staging evidence and remain disabled
in production.

```text
anonymous requester creates pending request
  -> access code stored as keyed hash
  -> owner hub sends pending notification type 15
  -> requester opens request-scoped anonymous hub
  -> different active owner device approves or denies once
  -> approval stores opaque requester-public-key encrypted user key
  -> anonymous hub sends response notification type 16
  -> requester reads response with request id + access code
  -> auth-request token grant atomically consumes approved request
  -> normal device-bound access and refresh session is issued
```

Failure invariants:

- unknown account, bad code, expired request, consumed request, and guessed id
  do not disclose account or request existence
- requester and approver device identifiers must differ
- denial cannot carry an encrypted key
- approval notifications contain no key material and cannot replace API readback
- expiry is fixed at creation and token consumption is single-use
- organization/admin approval remains unsupported

## Revoke Other Sessions

```text
recent password-authenticated user
  -> derive current device id from access token device claim
  -> revoke other active devices for this user
  -> revoke refresh tokens for other devices
  -> keep current device and current session active
```

Failure invariants:

- refresh-auth, stale password-auth, and legacy claimless tokens return
  `reauth_required`
- the current session is explicitly preserved
- successful outcomes are auditable when audit logging is enabled
