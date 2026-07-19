# Pinned official credential contract

Sources are public and pinned to server
`a09c7edb03ae6d4fdece784f1250c67be73d5fe0` and clients
`39f07436ca60e3f25eac47777671754f288a98f1`.

## Password verification and change

- `POST /accounts/verify-password` accepts a secret-verification payload and
  compares the client-derived master-password authentication hash. Success
  returns the currently enforced password-policy response; failure is delayed
  and generic at the HTTP error boundary.
- `POST /accounts/password` accepts the current authentication hash, matching
  new authentication/unlock data, and an optional hint. Current clients include
  both the newer structured data and legacy top-level fields during transition.
- Structured authentication and unlock data must use the same salt and KDF.
  Existing-password change additionally requires the incoming salt and KDF to
  equal the stored generation.
- The client derives the new authentication hash and wrapped user key locally.
  The server never receives the plaintext master password or unwrapped user key.
- A successful password change rotates the security stamp and requests logout
  of the user's other authenticated clients.

Primary paths at the pinned revisions above:

- Server: `src/Api/Auth/Controllers/AccountsController.cs`
- Server: `src/Api/Auth/Models/Request/Accounts/PasswordRequestModel.cs`
- Server: `src/Core/Auth/UserFeatures/UserMasterPassword/SelfServicePasswordChangeCommand.cs`
- Clients: `libs/common/src/auth/models/request/password.request.ts`
- Clients: `libs/angular/src/auth/password-management/change-password/default-change-password.service.ts`

## KDF change

- The client derives a new authentication hash and wrapped user key using the
  requested KDF, while presenting the old authentication hash for authorization.
- Authentication and unlock data must use the same unchanged account salt and
  the same new KDF generation.
- Server `v2026.6.1` bounds are inclusive: PBKDF2-SHA256 iterations
  `600000..2000000`; Argon2id iterations `2..10`, memory `15..1024` MiB, and
  parallelism `1..16`.
- Client `web-v2026.6.1` `Argon2KdfConfig` accepts Argon2id memory
  `16..1024` MiB for both setting and prelogin validation. HonoWarden therefore
  uses the server/client intersection `16..1024` MiB and rejects the
  server-only 15 MiB value before mutation.
- KDF mutation stores the new authentication hash, wrapped user key, KDF fields,
  security stamp, and account revision as one user generation. Logout is the
  default behavior for the pinned server.
- Password prelogin returns an exact stored generation for a known account and
  uses a normalized-email, keyed-hash selection over PBKDF2 and Argon2id decoys
  for an unknown account. HonoWarden preserves that stable mixed-algorithm
  property with its own domain-separated secret and selects from the actual
  client-readable stored population weighted by account count. This represents
  readable legacy tuples without synthesizing unused high-cost profiles.

Primary paths at the pinned revisions above:

- Server: `src/Api/Auth/Models/Request/Accounts/ChangeKdfRequestModel.cs`
- Server: `src/Core/KeyManagement/Kdf/Implementations/ChangeKdfCommand.cs`
- Server: `src/Core/Utilities/KdfSettingsValidator.cs`
- Server: `src/Core/KeyManagement/Kdf/KdfConstants.cs`
- Server: `src/Identity/Controllers/AccountsController.cs`
- Clients: `libs/common/src/key-management/kdf/change-kdf.service.ts`
- Clients: `libs/key-management/src/models/kdf-config.ts`

## Security stamp and account keys

- `POST /accounts/security-stamp` proves the current secret, rotates the stamp,
  and invalidates sessions bound to the old generation.
- `GET /accounts/keys` reads the account cryptographic state.
- `POST /accounts/keys` is a one-time keypair initialization path; it rejects a
  different replacement when keys already exist.
- Full user-key rotation is a separate all-data operation at
  `POST /accounts/key-management/rotate-user-account-keys`. It validates all
  folders, ciphers, Sends, recovery, WebAuthn, device, and account-key payloads
  before changing the password/key generation.

Primary paths at the pinned revisions above:

- Server: `src/Api/Auth/Controllers/AccountsController.cs`
- Server: `src/Api/KeyManagement/Controllers/AccountsKeyManagementController.cs`
- Clients: `apps/web/src/app/key-management/key-rotation/user-key-rotation-api.service.ts`

## HonoWarden ownership decision

Existing-account mutation belongs to HON-160. Initial password setting for a
passwordless/invite-created account belongs to HON-159, because HonoWarden does
not yet have a supported passwordless/TDE account lifecycle. TDE, Key Connector,
organization recovery, Send, Emergency Access, and WebAuthn rotation inputs stay
explicitly unsupported until their owning product slices exist.
