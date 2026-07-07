# Result 01: Repository

## Accepted

- Added `DeviceRecord` read model and owner-scoped active-device lookup methods.
- Repository SQL filters by `user_id` and `revoked_at IS NULL`.
- Repository tests cover list and identifier lookup with cross-user and revoked
  fixtures excluded by the test double.

## Verification

- `pnpm test -- test/repositories/auth-repository.test.ts -t "lists active devices|finds an active device"` passed.
- `pnpm check` passed after the repository implementation.
