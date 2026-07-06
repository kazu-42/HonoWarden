# Result 01: TOTP Domain

Accepted:

- Added Web Crypto HOTP/TOTP helpers with RFC test-vector coverage.
- Added base32 secret generation without padding.
- Added replay-aware verification output.
- Added AES-GCM setup-secret envelope keyed by `HONOWARDEN_TOTP_SECRET`.
- Extended password grant parsing for common two-factor form field names.

Rejected:

- Hash-only setup secret storage, because login verification requires recovering the shared secret.

Verification:

- `pnpm test -- test/domain/tokens.test.ts test/domain/totp.test.ts test/domain/totp-secret.test.ts`
