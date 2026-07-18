# Result 03: Pinned Server Security Contract

Status: accepted after main-agent fallback review. The delegated explorer did
not return before its bounded execution window and was stopped. All references
below were read directly from official server commit
`a09c7edb03ae6d4fdece784f1250c67be73d5fe0` (`v2026.6.1`).

## Pinned Routes And State

- `GET /identity/accounts/webauthn/assertion-options` is anonymous and returns
  discoverable assertion options plus a protected token scoped to
  authentication (`src/Identity/Controllers/AccountsController.cs`).
- `POST /identity/connect/token` accepts extension grant `webauthn`, reads
  `token` and JSON `deviceResponse`, verifies the protected token's
  authentication scope, asserts the credential, attaches the asserted
  credential to the decryption-options builder, and then runs normal device,
  account, policy, and token validation
  (`src/Identity/IdentityServer/RequestValidators/WebAuthnGrantValidator.cs`;
  `src/Identity/IdentityServer/ApiClient.cs`).
- Authenticated management is `GET /api/webauthn`,
  `POST /api/webauthn/attestation-options`,
  `POST /api/webauthn/assertion-options`, `POST /api/webauthn`,
  `PUT /api/webauthn`, and `POST /api/webauthn/{id}/delete`
  (`src/Api/Auth/Controllers/WebAuthnController.cs`).
- Creation and deletion perform explicit server-side secret verification.
  Create options and credential creation also enforce a policy check. PRF key
  enablement verifies an assertion scoped to `UpdateKeySet` before replacing the
  encrypted key triple (`src/Api/Auth/Controllers/WebAuthnController.cs`).

The credential entity stores row ID, user ID, name, base64url credential ID,
base64url COSE public key, counter, credential type, AAGUID, PRF support,
encrypted user/private/public keys, creation date, and revision date. It does
not store transports, backup eligibility/state, discoverability, last-used
time, disabled/deleted state, or an RP-policy version
(`src/Core/Auth/Entities/WebAuthnCredential.cs`).

## Ceremony Semantics

- Registration excludes existing credential IDs, uses the account UUID bytes as
  WebAuthn user ID, requires resident keys and user verification, accepts any
  authenticator attachment, and requests no attestation conveyance
  (`src/Core/Auth/UserFeatures/WebAuthnLogin/Implementations/GetWebAuthnLoginCredentialCreateOptionsCommand.cs`).
- Credential creation enforces a five-credential limit, verifies attestation
  with Fido2NetLib, checks credential-ID uniqueness within that user, and stores
  credential/public-key/counter/type/AAGUID plus optional PRF key material
  (`.../CreateWebAuthnLoginCredentialCommand.cs`).
- Assertion options are discoverable (`allowCredentials` empty) and require
  user verification (`.../GetWebAuthnLoginCredentialAssertionOptionsCommand.cs`).
- Assertion first marks the challenge used, parses the user handle as account
  UUID, loads that user's credentials, requires the asserted credential ID to
  belong to the user, verifies signature/RP/origin/UV/counter through
  Fido2NetLib, and replaces the stored counter
  (`.../AssertWebAuthnLoginCredentialCommand.cs`).

## Challenge And RP Translation

- Official registration tokens expire after seven minutes and are bound to user
  plus serialized options. Assertion tokens expire after 17 minutes and are
  scoped to authentication, PRF registration, or key-set update
  (`src/Core/Auth/Models/Business/Tokenables/WebAuthnCredentialCreateOptionsTokenable.cs`;
  `.../WebAuthnLoginAssertionOptionsTokenable.cs`;
  `src/Core/Auth/Enums/WebAuthnLoginAssertionOptionsScope.cs`).
- Assertion replay is tracked in a persistent distributed cache, but the pinned
  implementation performs a separate `GetAsync` then `SetAsync`. HonoWarden
  must not copy this race; D1 challenge consumption and credential counter
  update need a conditional, single-winner transition.
- The official server delegates RP ID/origin validation to configured
  Fido2NetLib. `GlobalSettings.Fido2.Origins` is an explicit origin set
  (`src/Core/Settings/GlobalSettings.cs`). HonoWarden must translate this to
  canonical, operator-owned RP/origin bindings and must never infer an allowed
  RP from request forwarding headers.

## Token And Vault-Key Semantics

- A WebAuthn grant is an allowed application grant and enters the normal token
  pipeline after assertion verification. Device validation and refresh-token
  behavior remain ordinary identity-server responsibilities
  (`src/Identity/IdentityServer/RequestValidators/WebAuthnGrantValidator.cs`).
- If and only if the asserted credential has a complete PRF encrypted key set,
  `UserDecryptionOptionsBuilder` emits one `WebAuthnPrfOption` containing its
  encrypted private/user keys, credential ID, and currently an empty transports
  array (`src/Identity/IdentityServer/UserDecryptionOptionsBuilder.cs`).
- PRF status is `Enabled` only when the authenticator supports PRF and all three
  encrypted key fields are present; otherwise it is `Supported` or
  `Unsupported` (`src/Core/Auth/Entities/WebAuthnCredential.cs`;
  `src/Core/Auth/Enums/WebAuthnPrfStatus.cs`).

## Security Improvements Required In HonoWarden

1. Use a maintained verifier library rather than implementing CBOR, COSE,
   attestation, authenticator-data, or signature verification locally. Current
   official SimpleWebAuthn documentation lists Cloudflare Workers as a supported
   compatible runtime; the exact dependency and Workers dry-run belong to the
   schema/core child.
2. Persist hashed challenges with account, ceremony purpose, RP ID, exact
   expected origin policy, expiry, and consumed state. Do not put reusable raw
   challenges or full options in logs, audit context, or evidence.
3. Make challenge consumption and credential creation/counter mutation
   conditional and race-safe. A failed assertion must not advance a counter;
   two concurrent uses of one challenge must yield one winner.
4. Preserve counter `0` for valid backup-eligible/synced credentials. Reject a
   positive counter regression and record backup state rather than assuming all
   authenticators have monotonic counters.
5. Store transports and backup flags because the current client can consume
   transports and they materially affect synced-passkey counter policy. Do not
   expose AAGUID or credential IDs outside the authenticated owner surface.
6. Return stable, enumeration-safe failures for anonymous options/grant paths.
   Internally distinguish malformed token, replay, unknown user handle,
   unknown/foreign credential, RP/origin mismatch, signature failure, and
   counter risk for audit and diagnosis without retaining raw payloads.
7. Bind the PRF response to the exact asserted credential. Never return another
   credential's encrypted key set and never accept PRF extension output from the
   client or server request.
8. Credential deletion must apply an explicit last-method/recovery rule and a
   defined session-revocation transition. Rename is not in the pinned official
   contract and must remain a separate HonoWarden extension.
9. Registration, login, and PRF enablement must remain unavailable unless the
   complete RP/origin policy is configured; partially configured environments
   fail loudly and advertise no support.
