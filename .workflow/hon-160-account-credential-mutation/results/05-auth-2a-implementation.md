# AUTH-2A implementation result

Status: source-ready locally.

## Accepted changes

- Added bounded parsing for camel-case and Pascal-case current authentication
  proof aliases. Conflicting aliases, OTP fields, whitespace/control
  characters, empty values, oversized values, arrays, and non-objects fail
  before mutation.
- Added a monotonic credential revision helper so a rotation always advances
  the account generation even when wall-clock time does not.
- Added one guarded D1 batch that updates the user generation, revokes all
  active owner devices and refresh tokens, supersedes pending or approved
  login-with-device requests, clears retained encrypted response keys, and
  inserts exactly one required redacted `account.security_stamp.rotate` audit
  event.
- Added `POST /api/accounts/security-stamp` behind recent password
  authentication and exact constant-time current-hash verification.
- Routed invalid current-hash proofs through the existing account/IP failure
  buckets, failed-login state, account lockout, and IP `Retry-After` policy
  before any credential mutation.
- Kept the mandatory transactional D1 audit row independent from optional
  Worker JSON-line emission; `HONOWARDEN_AUDIT_LOGS=false` suppresses only the
  console event.
- Kept password, KDF, account-key, and user-key mutation routes out of this
  slice.
- Extended fake D1 with transactional credential-rotation behavior and rollback
  snapshots without weakening unrelated tests.

## Security invariants

- The server receives no plaintext master password or unwrapped key.
- A stale user generation changes no credential, device, refresh-token,
  auth-request, or audit state.
- A failed required audit insert aborts the same D1 batch as the credential
  mutation.
- Successful rotation invalidates old access and refresh tokens; a new password
  login creates only a new forward session generation.
- Login-with-device approvals issued before rotation cannot mint a new session
  afterward.
- Repeated invalid proofs cannot remain an unthrottled online verifier, and a
  correct proof cannot bypass an active account or IP lock.
- Another user's devices, refresh tokens, and auth requests are not changed.

## Operational correction

An independent review found that mandatory credential audit rows could outlive
the documented 365-day boundary when optional audit emission was disabled.
Scheduled maintenance now always runs bounded D1 audit-event cleanup, with a
regression test for `HONOWARDEN_AUDIT_LOGS=false` and matching operations and
security documentation.

A later Codex review of the published PR head found that an approved
login-with-device request could survive rotation and mint a new session using
the new security stamp. The guarded batch now supersedes every pending or
approved owner request and clears its encrypted response key before committing
the required audit row. Focused route/repository tests and fresh local D1
success, rollback, cross-account, stale-approval, and concurrency readbacks
cover the corrected boundary.

The next Codex review found that invalid stamp proofs bypassed the password
grant's login-defense state and that successful rotation always emitted an
audit JSON line. The route now fails closed through the shared defense policy,
and console audit emission honors the configured toggle without weakening the
mandatory D1 audit insert. Focused tests and real-D1 readback cover account/IP
thresholds, blocked valid proofs, credential non-mutation, and disabled console
emission.

## Excluded

No password/KDF/key mutation, official-client compatibility promotion, remote
D1 write, production change, credential rotation for a real user, or GitHub
publication was performed.
