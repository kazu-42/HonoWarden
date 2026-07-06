# Packet 03: Route Integration

Objective: add authenticated setup and password-grant TOTP verification.

Ownership:

- `src/app.ts`
- `src/bindings.ts`
- `test/app.test.ts`
- `test/support/fake-d1.ts`

Expected output:

- Authenticated setup route returns a generated secret once and stores only the encrypted envelope.
- Authenticated verify route enables TOTP after a valid code.
- Password grant returns a TOTP challenge before token issuance for enabled accounts.
- Password grant verifies challenge, device binding, code, and timestep before issuing tokens.
- Sync profile reports stored TOTP enabled state.

Verification:

- App tests cover setup, setup verify, challenge response, valid challenge login, consumed challenge rejection, and sync state.
