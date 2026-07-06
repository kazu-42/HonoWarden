# Result 02: Alpha-Critical Fixtures

## Accepted

- Added fixtures for folder CRUD.
- Added fixtures for cipher create, update, trash, restore, and permanent
  delete.
- Added fixtures for stale revision conflict, device revoke, TOTP challenge,
  TOTP login success, and sync with one folder plus one active cipher.
- Added assertion support for arrays, absence, length, minimum length, and
  changed-token checks.

## Rejected

- Did not add live fixture replay for every route in this slice.
- Did not model tombstone sync because `/api/sync` currently returns active
  ciphers only.
