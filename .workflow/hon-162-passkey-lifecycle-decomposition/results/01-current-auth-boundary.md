# Result 01: Current Auth Boundary

Status: accepted.

## Capability Baseline

- HonoWarden has no WebAuthn/passkey route, domain type, repository, migration,
  compatibility fixture, or feature-state entry. A case-insensitive search for
  `webauthn`, `passkey`, and `fido` returns no implementation hit under `src/`,
  `migrations/`, or `test/`.
- `/api/config` and `/config` derive their advertised origins from the request
  and pass only that origin to a static config builder (`src/app.ts:596-605`).
  The current feature map contains no WebAuthn capability and keeps unrelated
  future capabilities false (`src/protocol/config.ts:28-60`).
- `Bindings` has no trusted RP ID, expected origin allowlist, WebAuthn feature
  switch, or challenge policy binding (`src/bindings.ts:1-26`). Request `Host`
  or forwarding headers therefore cannot safely become an implicit RP policy.

## Account, Vault-Key, And Session Boundary

- Users already carry the encrypted-vault material and global session-revocation
  marker: master-password hash, user key, public/private keys, and
  `security_stamp` (`migrations/0001_initial_schema.sql:8-26`). The auth read
  model exposes those values plus password lockout and TOTP state
  (`src/repositories/auth-repository.ts:3-26`).
- The token response returns `Key`, `PrivateKey`, KDF parameters, account keys,
  and only a master-password decryption option
  (`src/app.ts:4302-4339`). Authenticating a WebAuthn assertion would therefore
  not by itself give a client the material needed to decrypt the vault. Login
  WebAuthn and passkey-backed vault-key recovery must remain separate protocols.
- Devices and refresh tokens are user-scoped and cascade on account/device
  deletion (`migrations/0001_initial_schema.sql:31-67`). Trusted-device encrypted
  key columns were added separately (`migrations/0005_device_keys.sql:3-12`) and
  are updated only for a live, user-owned device
  (`src/repositories/auth-repository.ts:639-693`).
- Password login creates or refreshes the device session, persists a hashed
  refresh token, then issues an access token with `authMethod: 'password'`
  (`src/app.ts:1924-1960`). Refresh-token rotation detects reuse and invalidates
  the device session (`src/repositories/auth-repository.ts:1200-1306`). These
  primitives can be shared by a successful WebAuthn grant after assertion
  verification, but assertion verification must precede all session writes.
- Access tokens include device, security stamp, issued/expiry timestamps, and an
  auth-method discriminator. The discriminator currently permits only
  `auth_request`, `password`, or `refresh` (`src/domain/tokens.ts:61-76`). Every
  protected request re-reads the user and rejects a disabled user or mismatched
  security stamp (`src/app.ts:6574-6652`).
- Sensitive account/TOTP/device mutations require a password-authenticated token
  no older than five minutes (`src/app.ts:6780-6810`). A WebAuthn management
  design needs an explicit recent-proof rule; broadening this password-only
  helper implicitly would weaken an established invariant.

## Reusable Challenge And Abuse Controls

- TOTP challenges demonstrate the existing persistence shape: an opaque token is
  stored by hash and bound to user, device identifier, expiry, and consumed state
  (`migrations/0003_totp_login.sql:14-29`). The login path verifies the binding
  and atomically changes `consumed_at` before accepting the TOTP code
  (`src/app.ts:1820-1880`; `src/repositories/totp-repository.ts:297-343`).
- WebAuthn needs a new purpose-specific challenge table because registration and
  assertion also require RP ID, expected origin set, user/account binding,
  optional device binding, and ceremony purpose. Reusing `totp_challenges`
  would either overload unrelated semantics or omit mandatory bindings.
- Password login already applies IP/account failure buckets, user lockout,
  generic invalid-grant responses, and successful-reset semantics
  (`src/app.ts:1644-1805`, `src/app.ts:1928-1933`). Global request quota buckets
  provide a separate bounded, persistent anonymous/authenticated limiter
  (`migrations/0008_request_quotas.sql:3-20`). WebAuthn option issuance and
  assertion endpoints must choose and test both enumeration-safe errors and
  their quota scopes rather than inheriting them accidentally.
- Audit events support success/failure, request ID, actor, target, and structured
  context without a public read API (`migrations/0007_audit_events.sql:3-32`).
  Credential IDs, challenge bytes, user handles, public keys, attestation
  objects, and assertion payloads must never enter actor/target/context fields.
- Scheduled cleanup is bounded and idempotent and always cleans auth defenses,
  TOTP challenges, and pending attachments, while other classes are feature
  gated (`src/maintenance/retention-cleanup.ts:24-102`;
  `src/index.ts:16-40`). WebAuthn challenge cleanup should join this bounded path
  only when its migration and feature gate are available.

## Required New Boundaries

1. A default-off runtime policy must define canonical RP ID and exact expected
   origins for each environment. It must reject an incomplete policy loudly and
   must not derive trust from an attacker-controlled request header.
2. A dedicated credential entity must own credential ID, COSE public key,
   user handle, sign count, transports, discoverable/backup flags, name,
   timestamps, and disabled/deleted state. Secrets and raw ceremony payloads are
   not retained.
3. A dedicated challenge entity must bind account, ceremony purpose, RP ID,
   expected origin policy version, expiry, and single-use state. Consumption and
   credential/sign-counter mutation must be race-safe in D1.
4. Registration must require current authenticated recent proof and must not
   expose an active credential until attestation verification succeeds.
5. Assertion must distinguish unknown account/credential, origin/RP mismatch,
   malformed payload, replay, and counter risk internally while returning a
   stable enumeration-safe external failure.
6. Sign-count policy must preserve zero for valid synced/multi-device passkeys,
   record backup eligibility/state, and fail closed on an actual positive
   counter regression. No synthetic counter increments are allowed.
7. Rename/delete operations must be user-scoped, audited, and guarded by recent
   proof. Deletion must not remove the final usable recovery/authentication path
   without an explicit policy decision.
8. A successful assertion may create the existing device/refresh-token session
   and a distinct `webauthn` access-token method only after the client contract
   proves how vault-key material is supplied. Otherwise login remains
   non-advertised even when registration/storage source code exists.
9. Source capability, default-off environment activation, live authenticator
   evidence, and compatibility-matrix promotion are separate completion gates.

## One-PR Ownership Implications

- Contract/RP policy and default-off discovery can land independently without a
  database migration or support claim.
- Credential/challenge schema, repository transitions, and bounded cleanup need
  one migration owner before any route writes state.
- Registration, assertion/session issuance, and management operations should be
  separate route children consuming that repository contract.
- Activation, official-client evidence, rollback, and compatibility promotion
  belong to a final integration child after every security transition is source
  complete.
