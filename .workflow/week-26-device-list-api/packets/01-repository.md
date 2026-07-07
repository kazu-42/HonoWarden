# Packet 01: Repository

## Objective

Add owner-scoped read methods for active devices.

## Files

- `src/repositories/auth-repository.ts`
- `test/repositories/auth-repository.test.ts`

## Contract

- `listDevicesByUser(database, userId)` returns active, unrevoked device rows for
  one user only.
- `findDeviceByIdentifier(database, { userId, identifier })` returns one active
  device owned by that user or `null`.
- SQL must include `user_id = ?` and `revoked_at IS NULL`.

## Verification

- focused repository tests
- TypeScript check
