# Result 03: Route Integration

Accepted:

- Added authenticated setup and setup verification routes.
- Added password-grant challenge response for TOTP-enabled accounts.
- Added challenge hash lookup, device binding, single-use consume, code verification, and timestep advancement before token issuance.
- Reused login-defense failure handling for invalid second-factor attempts.
- Updated sync profile `TwoFactorEnabled` from stored account state.

Rejected:

- Issuing access or refresh tokens before second-factor verification.
- Storing plaintext setup secrets in D1.

Verification:

- `pnpm test -- test/app.test.ts test/repositories/auth-repository.test.ts`
