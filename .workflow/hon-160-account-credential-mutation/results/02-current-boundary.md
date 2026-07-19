# Current HonoWarden credential boundary

## Existing reusable state

- `migrations/0001_initial_schema.sql` already stores KDF algorithm/parameters,
  client-derived master-password hash, wrapped user key, public/private key,
  security stamp, revision, devices, and refresh-token hashes.
- `src/domain/tokens.ts` performs constant-time comparison of the presented
  client-derived hash and signs access tokens with the current security stamp.
- `authenticateVaultRequestWithAccessToken` reloads the user and rejects access
  tokens whose stamp no longer matches.
- `authenticateRecentPasswordRequest` already restricts sensitive routes to a
  recent access token issued by a password grant.
- `src/repositories/auth-repository.ts` has device and refresh-token revocation
  primitives, but no all-device credential-generation transaction.
- `src/repositories/user-repository.ts` owns user mutation and is the narrowest
  place for a guarded credential transaction.

## Missing invariants

- No `/api/accounts/verify-password`, `/password`, `/kdf`, `/security-stamp`, or
  `/keys` route exists.
- No repository operation atomically updates user credential generation,
  rotates the security stamp, revokes all refresh/device sessions, and persists
  a required audit row.
- Current token/profile/master-password-unlock projections map every KDF
  algorithm to type `0`; Argon2id would therefore be persisted but reported as
  PBKDF2.
- `resolvePrelogin` returns a global PBKDF2 default and does not project a
  known user's stored KDF. Enumeration resistance and known-user correctness
  need one carefully bounded contract rather than a direct existence oracle.
- Existing audit persistence occurs after most mutations. A credential success
  audit failure could otherwise return an error after the credential already
  changed. AUTH-2A must put the required audit insert in the same D1 batch.
- Current fake D1 has no credential transaction model, so host tests need both
  fake support and a real local SQLite/D1 abort/concurrency proof.

## Foundation edit points

- Add structured credential parsing/validation under `src/domain/`.
- Add guarded transactional mutation and revocation under
  `src/repositories/user-repository.ts` or a dedicated credential repository if
  the user repository becomes incohesive.
- Extend `AuditEventName` with redacted account-credential events and reuse the
  existing audit schema without logging hashes, keys, payloads, or tokens.
- Expose only `/api/accounts/security-stamp` in AUTH-2A. Password, KDF, and key
  routes remain absent until their children satisfy their own contracts.
- Extend `test/support/fake-d1.ts` only enough to model the exact guarded batch;
  do not rely on fake behavior for atomicity evidence.

## Migration decision

AUTH-2A requires no migration and therefore does not collide with HON-161's
unmerged `0015_personal_api_keys.sql`. Password-hint persistence or later
credential metadata that requires schema changes must wait for an unambiguous
post-HON-161 migration number or declare an explicit publication dependency.
