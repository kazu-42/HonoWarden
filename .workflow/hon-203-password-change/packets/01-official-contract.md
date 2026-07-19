# Packet 01: Official Contract

## Objective

Pin the verify-password and password-change wire contracts used by the tracked
official upstream server/client baseline.

## Evidence

- Server tag `v2026.6.1`, commit
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`:
  - `src/Api/Auth/Controllers/AccountsController.cs`
    declares authenticated `POST accounts/verify-password` and
    `POST accounts/password` routes. Verify-password checks
    `MasterPasswordHash` and returns a `MasterPasswordPolicyResponseModel`.
  - `src/Api/Auth/Models/Request/Accounts/PasswordRequestModel.cs`
    requires the current `MasterPasswordHash` plus either the structured
    `AuthenticationData`/`UnlockData` pair or transitional legacy
    `NewMasterPasswordHash`/`Key` pair. Both may be present.
  - `src/Core/KeyManagement/Models/Api/Request/MasterPasswordAuthenticationDataRequestModel.cs`
    carries KDF, authentication hash, and salt.
  - `src/Core/KeyManagement/Models/Api/Request/MasterPasswordUnlockDataRequestModel.cs`
    carries the same KDF/salt and opaque master-key-wrapped user key.
  - `src/Core/Auth/UserFeatures/UserMasterPassword/Data/UpdateExistingPasswordData.cs`
    explicitly requires authentication/unlock KDF and salt to remain unchanged
    and rotates the security stamp by default.
- Client tag `web-v2026.6.1`, commit
  `39f07436ca60e3f25eac47777671754f288a98f1`:
  - `libs/common/src/auth/models/request/password.request.ts`
    shows the pinned client emits both structured and legacy fields in the
    same request.
  - `libs/angular/src/auth/password-management/change-password/default-change-password.service.ts`
    derives current authentication proof plus new auth/unlock data from the
    same stored KDF and salt before posting the request.
  - `libs/common/src/auth/services/master-password/master-password-api.service.implementation.ts`
    confirms authenticated `POST /accounts/password` with no response payload
    dependency.

Pinned wire decisions:

- Verify accepts only the issue-owned current hash proof, not OTP/access-code
  alternatives from the wider upstream secret-verification model.
- Password change accepts structured-only, legacy-only, and the pinned dual
  representation. A dual representation must agree byte-for-byte even though
  upstream currently prefers structured data without cross-checking legacy.
- Structured authentication and unlock salt/KDF must agree with each other and
  with the existing account. KDF strength is not upgraded by this endpoint.
- Success is HTTP 200 with an empty body. Verify returns an empty
  `masterPasswordPolicy` projection with the official nullable fields.

## Result

Completed. The implementation contract is pinned to immutable upstream commits
and deliberately narrows unsupported proof alternatives.
