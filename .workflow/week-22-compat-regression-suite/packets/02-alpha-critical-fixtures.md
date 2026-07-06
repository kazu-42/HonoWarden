# Packet 02: Alpha-Critical Fixtures

## Objective

Add synthetic fixtures for the alpha compatibility surface and strengthen
fixture assertions enough to detect shape drift.

## Scope

- `compat/fixtures/**`
- `test/compat/compat-fixtures.test.ts`

## Result

Added folder, cipher, sync-with-items, revision conflict, device revoke, and
TOTP login fixtures. The fixture harness now supports array indexes, absent
fields, exact lengths, minimum lengths, and `notValue` checks.
