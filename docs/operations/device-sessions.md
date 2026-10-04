# Device session binding

This is the rollout and recovery contract for local source migration
`0023_device_session_binding.sql`. It is not authorization to deploy or apply a
remote migration. The published alpha evidence remains a historical record.

## Why a device identifier is insufficient

A signed access token used to be validated against the user and security stamp
without consulting device revocation. Revoking a device or detecting refresh
token reuse therefore left an already issued bearer usable until its one-hour
expiry. Checking only an active device row also permits an older bearer to become
valid again when the same device identifier logs in and clears its revoked state.

The new login establishes an opaque, immutable session ID using the initially
allocated refresh-token record ID. The device, refresh family, and access token
carry that generation. Vault authentication requires the matching user, device
identifier, active device state, session ID, and current security stamp. Refresh
rotation preserves the family ID and checks it against the current device in the
same database transaction. A new login replaces the generation, so an old bearer
or refresh family cannot regain access or revoke the newer login.

Targeted device revocation updates the device and its refresh tokens in one D1
batch. A fresh login cannot interleave between those writes, and failure of the
refresh-token update rolls the device revocation back. A missing/already-revoked
target does not mutate refresh families.

Password, personal API-key, and approved login-with-device grants follow the same
binding. Refreshing a valid family preserves existing access tokens from that
family until their normal expiry; it does not create a new login generation.

## Rollout order and compatibility

The additive nullable columns must exist before the session-aware application
queries them. Migration 0023 does not manufacture a generation for existing
sessions. Tokens with a missing generation and old refresh rows with NULL
`session_id` fail closed and require a fresh login. Announce this one-time login
requirement before any separately authorized rollout. Existing encrypted vault
records, master-password material, and signing-key rotation policy are unchanged.

The rollout acceptance must verify a fresh login, populated sync, refresh,
device revoke, revoke-other-devices, refresh reuse, and same-device relogin on the
exact deployed source. HTTP health alone cannot demonstrate revocation behavior.
The current source is tested with synthetic local D1; remote schema application,
traffic activation, and official-client acceptance remain separate gates.

Revocation applies on the next authorization check. A request authenticated
before a concurrent revocation can still finish; this change does not add
transactional cancellation of in-flight vault writes. Termination of an already
open WebSocket remains the notification hub's separate revocation boundary.

## Failure and recovery

Missing schema or database infrastructure errors return 503 and are reported
through the existing vault-authentication error logger. Invalid, missing,
revoked, or superseded sessions return 401. No token, session identifier,
credential, or vault payload belongs in shared diagnostics.

Retain migration 0023 on application rollback. Do not reactivate a pre-binding
application that accepts old bearer tokens solely from a user security stamp:
that reopens the observed revocation defect. Use a reviewed recovery build that
preserves the session check, or stop authenticated traffic until one is available.
Do not clear revoked state or copy session IDs to repair client login; require a
fresh authorized login. Do not roll back ciphertext, delete session history, or
reuse another device's generation.

The single-active-generation rule means concurrent fresh logins using the same
device identifier leave one current session. The losing generation must fail
closed. Clients needing independent sessions must use distinct device identifiers.
