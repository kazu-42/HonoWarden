# Authentication State Machine

Last reviewed: 2026-07-06.

This document records the server-side authentication and session states that
must remain stable for alpha.

## Account States

| State              | Entered By                             | Allowed Actions                                        | Rejected Actions                                 |
| ------------------ | -------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| no account         | default                                | prelogin metadata only                                 | password grant, sync, refresh                    |
| active             | bootstrap                              | password grant, refresh, sync, vault CRUD              | none by account state                            |
| temporarily locked | failed password attempts               | prelogin, eventual retry                               | password grant until lock expires                |
| TOTP setup pending | authenticated setup                    | setup verify                                           | login without valid challenge if TOTP is enabled |
| TOTP enabled       | setup verify                           | password grant followed by TOTP challenge verification | token issuance without TOTP code                 |
| disabled           | future admin action or direct DB state | none for auth/session use                              | password grant, refresh grant, sync, vault CRUD  |

## Password Grant

```text
request
  -> token secret configured?
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

- missing token secret returns server misconfigured
- missing device metadata returns invalid request
- unknown, disabled, locked, or wrong-password account returns generic
  invalid-grant wording
- login defense failures are recorded without plaintext client address storage

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
  -> token secret configured?
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

## Access Token Verification

```text
bearer token
  -> HMAC signature valid?
  -> exp still valid?
  -> user exists?
  -> user not disabled?
  -> security stamp still matches?
  -> authenticated request context
```

Recent-auth invariant:

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
