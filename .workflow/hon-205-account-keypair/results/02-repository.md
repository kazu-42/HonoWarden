# Packet 02 result: repository

## Implementation

- Added `initializeAccountKeyPair` to the credential repository.
- The user statement requires the authenticated user id, active status, both
  account-key columns null, expected security stamp, and expected revision.
- The statement writes the opaque public/wrapped-private pair, advances
  revision/updated time, and uses `RETURNING id` as the single-row success
  signal.
- One `account.keys.initialize` audit event is inserted through a guarded
  `INSERT ... SELECT` in the same two-statement D1 batch.
- The mutation deliberately has no device, refresh-token, auth-request, master
  password, KDF, wrapped user-key, or security-stamp write.

## Invariants proved

- Active both-null state initializes once.
- Cross-user id, disabled user, stale stamp, stale revision, either existing
  half, or a complete existing pair returns conflict with no state change.
- User-statement and audit-statement failures restore the original row and
  leave no audit event in the fake transactional model.
- Two concurrent different initializations produce exactly one initialized
  result, one conflict, and one audit event.
- Existing devices, refresh tokens, and auth requests remain byte-equivalent
  after success.
- Audit output includes only version/session/stamp policy metadata and contains
  neither opaque key value.

## Verification

- Domain + repository focused suite: 2 files / 49 tests passed.
- TypeScript `pnpm check`: passed.

No migration, deployment, remote D1 mutation, real-account key change, or
session invalidation occurred.
