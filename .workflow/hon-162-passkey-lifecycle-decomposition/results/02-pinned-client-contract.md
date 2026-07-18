# Result 02: Pinned Client Contract

Status: accepted after main-agent fallback review. The delegated explorer did
not return before its bounded execution window and was stopped. All references
below were read directly from official clients commit
`39f07436ca60e3f25eac47777671754f288a98f1` (`web-v2026.6.1`).

## Anonymous Assertion And Token Grant

- The client gets discoverable assertion options with an unauthenticated
  `GET /accounts/webauthn/assertion-options` against the configured identity
  base URL. For HonoWarden that means
  `GET /identity/accounts/webauthn/assertion-options`
  (`libs/common/src/auth/services/webauthn-login/webauthn-login-api.service.ts`).
- The response contains `{ options, token }`. The client base64url-decodes
  `challenge` and every `allowCredentials[].id`, and accepts `rpId`, `timeout`,
  `userVerification`, and extensions
  (`libs/common/src/auth/services/webauthn-login/response/credential-assertion-options.response.ts`;
  `.../response/assertion-options.response.ts`).
- The browser calls `navigator.credentials.get()` and requests the WebAuthn PRF
  extension with a client-derived salt. It serializes `id`, base64url `rawId`,
  authenticator data, signature, client data JSON, and user handle. It
  deliberately replaces extension results with `{}` so PRF output cannot leave
  the client
  (`libs/common/src/auth/services/webauthn-login/webauthn-login.service.ts`;
  `.../request/webauthn-login-assertion-response.request.ts`;
  `.../request/webauthn-login-response.request.ts`).
- Login posts the normal identity token form with `grant_type=webauthn`, the
  opaque `token`, a JSON-stringified `deviceResponse`, client/device fields, and
  normal scopes to `/identity/connect/token`
  (`libs/common/src/auth/models/request/identity-token/webauthn-login-token.request.ts`;
  `libs/auth/src/common/login-strategies/webauthn-login.strategy.ts`).
- This pinned client does not implement a WebAuthn two-factor continuation. If
  the token response requires another factor, it shows an update/error state
  instead (`libs/auth/src/common/login-strategies/webauthn-login.strategy.ts`;
  `libs/angular/src/auth/login-via-webauthn/login-via-webauthn.component.ts`).

## Authenticated Credential Management

The Web client uses the configured API base URL, so these paths are HonoWarden
`/api/webauthn` routes:

| Operation             | Client request                         | Proof/body contract                                                             |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| Registration options  | `POST /webauthn/attestation-options`   | `SecretVerificationRequest`                                                     |
| PRF assertion options | `POST /webauthn/assertion-options`     | `SecretVerificationRequest`                                                     |
| Create credential     | `POST /webauthn`                       | attestation response, name, token, `supportsPrf`, optional encrypted key triple |
| List credentials      | `GET /webauthn`                        | application bearer token                                                        |
| Enable PRF encryption | `PUT /webauthn`                        | assertion response, token, required encrypted key triple                        |
| Delete credential     | `POST /webauthn/{credentialId}/delete` | `SecretVerificationRequest`                                                     |

The route calls and response parsing are in
`apps/web/src/app/auth/core/services/webauthn-login/webauthn-login-admin-api.service.ts`.
`SecretVerificationRequest` can carry master-password hash, OTP, or auth-request
access code, but the current HonoWarden slice can claim only the proof methods it
actually verifies
(`libs/common/src/auth/models/request/secret-verification.request.ts`).

- Registration calls `navigator.credentials.create()` and asks whether PRF is
  enabled. A credential can then be saved with or without a PRF key set
  (`apps/web/src/app/auth/core/services/webauthn-login/webauthn-login-admin.service.ts`).
- The client limit is five credentials. List responses expose only server row
  ID, name, PRF status, and encrypted user/public keys. The three PRF states are
  enabled, supported-but-not-enabled, and unsupported
  (`.../webauthn-login-admin.service.ts`;
  `.../response/webauthn-login-credential.response.ts`;
  `.../enums/webauthn-login-credential-prf-status.enum.ts`).
- The pinned client has create/list/delete and PRF-enable operations, but no
  credential rename API call. HonoWarden's requested rename behavior therefore
  needs an original authenticated API and tests; it cannot be promoted as an
  official-client compatibility surface for this pin.

## Vault-Key PRF Boundary

- The PRF salt is `SHA-256("passwordless-login")`. The client HKDF-expands the
  authenticator PRF result into separate encryption and MAC halves. Neither the
  salt-derived PRF result nor the resulting symmetric key is sent to the server
  (`libs/common/src/auth/services/webauthn-login/webauthn-login-prf-key.service.ts`).
- During enrollment or later enablement, the client uses the PRF key to create a
  key set and sends only encrypted user/public/private-key material. The
  authenticated create request allows that encrypted triple to be absent when
  the authenticator lacks PRF
  (`apps/web/src/app/auth/core/services/webauthn-login/request/save-credential.request.ts`;
  `.../request/enable-credential-encryption.request.ts`).
- After a WebAuthn grant, the token response may carry exactly one
  `UserDecryptionOptions.WebAuthnPrfOption` containing encrypted private key,
  encrypted user key, credential ID, and transports. The client unwraps the
  private key with its local PRF key, then decapsulates the user key
  (`libs/common/src/auth/models/response/user-decryption-options/user-decryption-options.response.ts`;
  `.../webauthn-prf-decryption-option.response.ts`;
  `libs/auth/src/common/login-strategies/webauthn-login.strategy.ts`).
- The login success handler runs only when a user key was recovered. Therefore a
  valid WebAuthn assertion without a matching PRF key set can authenticate an
  account but cannot be claimed as passwordless Vault unlock for this client.

## Browser, Desktop, Native, And CLI Implications

- The common Angular login flow is wired for Web, Browser, Desktop, and a CLI
  route label, but actual credential ceremonies still require a WebAuthn-capable
  host and `navigator.credentials`. This source pin is not evidence that `bw`
  CLI can perform the ceremony headlessly.
- The browser extension and desktop host share common service contracts but have
  host-specific WebAuthn connectors/native modules. Origin and RP acceptance
  must be proven per supported host; one browser-origin success cannot authorize
  arbitrary extension, desktop, or localhost origins.
- `FeatureFlag.WebAuthnRelatedOrigins` exists and defaults false, but the login
  and credential API contract is not advertised by a dedicated config feature
  key in this pin (`libs/common/src/enums/feature-flag.enum.ts`). HonoWarden must
  use its own default-off runtime policy and compatibility documentation rather
  than inventing a client-recognized capability flag.

## Contract Consequences

1. Preserve the exact anonymous options and `grant_type=webauthn` wire shape.
2. Keep PRF results client-only and never log extension output.
3. Return `WebAuthnPrfOption` only for the exact asserted credential and only
   when its encrypted key triple is complete.
4. Treat authenticated credential CRUD, assertion login, and PRF-backed Vault
   unlock as separate implementation/evidence gates.
5. Keep native, extension, custom-domain, and localhost origins explicit and
   disabled until their exact host evidence passes.
