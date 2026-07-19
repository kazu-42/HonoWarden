# Packet 02: Security Boundary

## Objective

Map current authentication, credential-generation, D1 transaction, audit, and
Durable Object session-invalidation boundaries before implementation.

## Evidence

- `authenticateVaultRequest` verifies the bearer token, active user, and current
  security stamp before exposing the current `AuthUserRecord` generation.
- `checkCredentialProofDefense` and `recordCredentialProofFailure` already
  provide IP/account lockout state for high-value current-hash proofs.
- `rotateAccountSecurityStamp` already owns one D1 batch containing guarded user
  generation update, all active device and refresh-token revocation, active
  auth-request supersession, and mandatory audit insertion.
- Access tokens embed the security stamp; rotating it rejects every old access
  token on the next authenticated request. Revoked D1 device/refresh rows reject
  old refresh grants.
- Durable notification sockets are not transactional with D1. Existing code
  checks the binding before mutation, then invalidates sockets using the newly
  committed generation and returns an explicit 503 if cleanup is incomplete.

Implementation boundary:

- Reuse the existing proof defense for verify and password change.
- Add a dedicated guarded password-change batch rather than mutating credentials
  through a sequence of repository calls. Its user guard includes current hash,
  stamp, revision, email-derived salt, and all KDF columns.
- The batch changes only `master_password_hash`, `user_key`, `security_stamp`,
  `revision_date`, and `updated_at`; it must not write KDF/email/vault rows.
- A false guard produces `revision_conflict` with zero session or audit changes.
  Any batch exception relies on D1 transactional batch rollback and is surfaced
  as `database_unavailable`.
- A non-empty hint is rejected before proof/mutation because HonoWarden has no
  password-hint persistence contract; absent, null, and empty mean no hint.
- Successful proof verification has no security-state write. Failed proofs write
  only the existing login-defense state and never audit secret material.

## Result

Completed. D1 is the atomic credential/session boundary; Durable Object socket
cleanup remains an explicit post-commit operational boundary.
