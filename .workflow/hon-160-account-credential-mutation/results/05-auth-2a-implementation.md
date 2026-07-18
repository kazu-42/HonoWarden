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
  active owner devices and refresh tokens, and inserts exactly one required
  redacted `account.security_stamp.rotate` audit event.
- Added `POST /api/accounts/security-stamp` behind recent password
  authentication and exact constant-time current-hash verification.
- Kept password, KDF, account-key, and user-key mutation routes out of this
  slice.
- Extended fake D1 with transactional credential-rotation behavior and rollback
  snapshots without weakening unrelated tests.

## Security invariants

- The server receives no plaintext master password or unwrapped key.
- A stale user generation changes no credential, device, refresh-token, or
  audit state.
- A failed required audit insert aborts the same D1 batch as the credential
  mutation.
- Successful rotation invalidates old access and refresh tokens; a new password
  login creates only a new forward session generation.
- Another user's devices and refresh tokens are not changed.

## Operational correction

An independent review found that mandatory credential audit rows could outlive
the documented 365-day boundary when optional audit emission was disabled.
Scheduled maintenance now always runs bounded D1 audit-event cleanup, with a
regression test for `HONOWARDEN_AUDIT_LOGS=false` and matching operations and
security documentation.

## Excluded

No password/KDF/key mutation, official-client compatibility promotion, remote
D1 write, production change, credential rotation for a real user, or GitHub
publication was performed.
