# Result 02: Schema And Repository

Accepted:

- Added `0003_totp_login.sql`.
- Added `user_totp` and `totp_challenges` to schema health.
- Added TOTP repository functions for setup, enablement, accepted-step recording, challenge creation, active challenge lookup, and challenge consume.
- Extended auth user lookup rows with TOTP state.

Rejected:

- Read-then-write replay guards. Timestep and challenge consume are conditional updates checked through affected rows.

Verification:

- `pnpm test -- test/repositories/totp-repository.test.ts test/migrations.test.ts test/infra/db-health.test.ts`
