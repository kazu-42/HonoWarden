# Packet 01: Repository

## Objective

Add an active-device existence lookup for login preflight.

## Files

- `src/repositories/auth-repository.ts`
- `test/repositories/auth-repository.test.ts`

## Contract

- Input is normalized email plus device identifier.
- Return `true` only when an active user owns an unrevoked device with that
  identifier.
- Unknown users, missing devices, cross-user devices, disabled users, and revoked
  devices return `false`.

## Verification

- focused repository tests
