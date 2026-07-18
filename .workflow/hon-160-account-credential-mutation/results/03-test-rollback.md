# Credential mutation test and rollback matrix

## AUTH-2A foundation

Positive evidence:

- Recent password-authenticated token plus exact current authentication hash
  rotates the security stamp, user revision, all active refresh tokens/devices,
  and one redacted success audit in one guarded D1 batch.
- A subsequent login can recreate/unrevoke its device session while old access
  and refresh tokens remain invalid.

Fail-closed evidence:

- Missing, malformed, expired, refresh-issued, auth-request-issued, or stale
  access tokens cannot enter the mutation.
- Invalid current hash returns a generic failure and changes no user/session
  state; rate-limit and audit behavior do not reveal account existence.
- Expected-stamp/revision mismatch from a concurrent mutation changes zero rows
  and cannot revoke the newer generation.
- Forced user-update, session-revoke, or audit-insert failure rolls the complete
  batch back. No false success response or success log is emitted.
- Disabled user and database failure are distinct operational failures without
  leaking credential data.

## Later child matrix

- AUTH-2B: structured and required legacy password payloads; unchanged KDF and
  salt; invalid old hash; old/new password grants; old/new access and refresh
  tokens; non-empty unsupported hint policy until storage exists.
- AUTH-2C: every PBKDF2/Argon2id boundary and just-outside value; missing or
  mismatched memory/parallelism; mixed auth/unlock KDF; salt drift; prelogin,
  token, profile, and sync projections; clean relogin and local unlock.
- AUTH-2D: empty keypair, exact idempotent replay, partial existing pair,
  different replacement, malformed/oversized opaque values, and GET shape.
- AUTH-2E: complete folder/cipher id set, duplicate/missing/foreign/deleted
  records, stale revisions, attachment-bearing ciphers, unsupported non-empty
  product arrays, D1 abort, and exact post-rotation readback.
- AUTH-2F: isolated official-client password/KDF/key lifecycle, restart, sync,
  rollback/disable, compatibility level, and synthetic cleanup.

## Rollback rule

Before production activation, rollback is code/feature disable only; additive
state remains readable by the previous release. A successfully committed
credential generation is never "rolled back" by restoring an old hash or old
security stamp, because that would resurrect compromised sessions. Recovery is
a new forward credential generation after reauthentication.

No real account, production Worker, plaintext password, raw token, unwrapped
key, or private vault data is used in any local or committed evidence.
