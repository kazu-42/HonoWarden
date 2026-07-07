# Result 01: Seed Type

Implemented locally:

- Added `refreshSession` to the compatibility fixture replay database seed type.
- Added `refreshRotationChanges` to the same seed type.
- Passed both fields through `buildDatabaseSeed` so existing `FakeD1Database`
  behavior can be reused without modification.

Verification:

- `pnpm check` passed.
