# Packet 01: TOTP Domain

Objective: implement pure TOTP helpers.

Ownership:

- `src/domain/totp.ts`
- `src/domain/totp-secret.ts`
- `src/domain/tokens.ts`
- `test/domain/totp.test.ts`
- `test/domain/totp-secret.test.ts`
- `test/domain/tokens.test.ts`

Expected output:

- Base32 secret generation.
- HOTP/TOTP verification.
- Replay-aware verification result.
- Encrypted secret envelope for setup secret persistence.
- Password grant parser support for two-factor form fields.

Verification:

- Domain tests pass.
- No real secrets in fixtures.
