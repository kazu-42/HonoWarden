# Result 01: Repository

## Accepted

- Added active known-device existence lookup by normalized email and device
  identifier.
- SQL joins users and devices, filters disabled users, and excludes revoked
  devices.
- Repository tests cover hit and miss behavior and assert owner/revoked SQL
  predicates.

## Verification

- `pnpm test -- test/repositories/auth-repository.test.ts -t "known device|active known device"` passed.
- `pnpm check` passed after repository implementation.
