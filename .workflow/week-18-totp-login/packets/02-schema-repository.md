# Packet 02: Schema And Repository

Objective: persist TOTP setup state and login challenges safely.

Ownership:

- `migrations/0003_totp_login.sql`
- `src/repositories/totp-repository.ts`
- `src/repositories/auth-repository.ts`
- `src/infra/db-health.ts`
- repository and migration tests

Expected output:

- `user_totp` stores encrypted setup secret, enabled state, verification timestamp, and last accepted timestep.
- `totp_challenges` stores hashed, expiring, device-bound, single-use login challenges.
- Accepted timestep and challenge consume operations are conditional D1 updates based on affected rows.

Verification:

- Repository tests prove conditional update behavior.
- Migration tests include required tables and indexes.
