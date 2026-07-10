# Auth Request Staging Evidence

Status: passed for the HTTP and token-grant lifecycle on 2026-07-11 JST.

This evidence covers `HON-82` and `HON-83`: the feature-flagged
login-with-device HTTP lifecycle and replay-safe token consumption. It does not
promote notifications, official-client UI compatibility, or production.

## Deployment

- Source merge commit: `7bd7890868515e6063e60cb4ba18f7dcedbb016b`
- GitHub pull request: `#69`
- Staging Worker version: `e655dde3-78d6-46e5-a417-573c2ab03243`
- Token-grant implementation merge commit:
  `87065accc56ebdad1dc5ba25e0f25046942ed49c`
- Token-verifier repair merge commit: `f43ebe4`
- Token-grant pull requests: `#71`, `#72`
- Final staging Worker version: `ae3979f2-130b-498e-a7b2-575e08df95b2`
- Staging URL: `https://honowarden-staging.ghive42.workers.dev`
- Health readback: HTTP 200, environment `staging`, version `0.1.0-alpha`
- D1 migration readback: no pending migrations through `0012`
- Staging flag: `HONOWARDEN_AUTH_REQUESTS_ENABLED=true`
- Production flag in repository config: `false`

The staging runtime has a dedicated auth-request HMAC secret. The test also
restored a complete staging access-token keyring because the Worker initially
had no usable token-exchange configuration. Evidence records names and
configured state only; no secret, token, email, password hash, access code, or
encrypted key value was retained.

## Synthetic Lifecycle

A temporary synthetic user and active approving device were inserted into the
empty staging D1 database. The device primary key followed the repository's
`userId:deviceIdentifier` invariant. The following live checks passed:

- password grant issued a device-bound bearer token;
- anonymous type `0` request creation returned the compatible auth-request
  response shape;
- a different active owner device approved the request;
- correct-code polling returned the approved opaque encrypted key;
- wrong-code polling returned the generic not-found response;
- an identical approval replay returned the current public state;
- a conflicting approval replay returned HTTP 409;
- anonymous type `1` request creation succeeded;
- owner denial persisted without accepting or returning key material;
- correct-code polling returned the denied state without key material.

The local verification before deployment passed 73 test files and 651 tests,
typecheck, lint, formatting, brand scan, and the strict release gate with 11
passes and no blocks.

## Token Grant And Repair Loop

The token grant used the public client form contract: `grant_type=password`,
username, access code in the password field, auth-request id, and requester
device metadata. The live checks passed after the final deployment:

- an approved type `0` request was atomically consumed;
- the conditional D1 batch inserted the requester device/session and changed
  the request from approved to consumed;
- the issued JWT carried `authMethod=auth_request` and the requester device;
- the issued access token authenticated a live sync request;
- replaying the same auth-request grant returned the generic invalid grant;
- the issued refresh token rotated through the normal refresh-token path;
- D1 readback showed consumed status, a consumed timestamp, and the expected
  original plus rotated requester session rows before cleanup.

The first staging attempt exposed a verifier allowlist defect: signing accepted
the new auth method, but authenticated routes rejected the resulting token.
PR `#72` added a sign-and-verify regression test and extended the verifier
allowlist. The full lifecycle was then rerun from a fresh synthetic fixture and
passed. Final local verification was 73 test files and 658 tests.

## Cleanup And Readback

The synthetic user was deleted in a `finally` cleanup. D1 foreign keys removed
its device, refresh token, and owned auth requests. One earlier ownerless
secret-check request was deleted by its synthetic requester identifier.

Final readback reported:

- users: `0`
- devices: `0`
- refresh tokens: `0`
- auth requests: `0`
- foreign-key violations: `0`

Hashed quota and login-defense metadata may remain until the bounded hourly
retention cleanup. It contains no raw email, device identifier, client address,
access code, or token.

## Rollback

Set `HONOWARDEN_AUTH_REQUESTS_ENABLED=false` in staging and redeploy. This
restores explicit 501 responses and disables auth-request cleanup queries. Do
not delete or reopen consumed rows. Production remains disabled and was not
deployed or migrated by this operation.

## Remaining Gates

- `HON-80`: notification hint delivery and official-client lifecycle evidence;
- production migration, secret configuration, enablement, and rollback drill.
