# Packet 01 Result: Defense Domain

Accepted:

- Added `src/domain/login-defense.ts`.
- Account lockout threshold, stale failure windows, active lock detection, hashed auth-attempt buckets, and client address extraction are covered by unit tests.
- Client address buckets do not contain plaintext addresses.

Verification:

- Targeted domain tests passed.
- Full `pnpm test` passed with 16 files and 146 tests.

Remaining risks:

- Missing client-address headers share the `unknown` bucket.
