# Packet 01: Seed Type

## Objective

Allow compatibility fixture replay options to pass a seeded refresh-token
session through to `FakeD1Database`.

## Ownership

`test/compat/fixture-replay-support.ts`.

## Do

- Add `refreshSession` to the replay database seed type.
- Preserve existing seed behavior.

## Do Not

- Do not change FakeD1 behavior unless route replay proves it is missing.
- Do not change production code.

## Expected Output

TypeScript accepts route replay fixtures that seed `refreshSession`.
