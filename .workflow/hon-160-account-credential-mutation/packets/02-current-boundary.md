# Packet 02: Current HonoWarden boundary

## Objective

Map existing schema, request authentication, token/session invalidation,
repository, audit, tests, and compatibility projections relevant to HON-160.

## Files

`migrations/`, `src/domain/`, `src/repositories/`, `src/app.ts`, `test/`,
`compat/`, and current security/compatibility documentation.

## Do

- Identify reusable primitives and missing atomicity/concurrency invariants.
- Confirm which first child can ship without a migration.
- Identify every current projection that assumes PBKDF2.

## Do Not

- Do not edit product code in this packet.
- Do not treat fake-D1 behavior as proof of real SQLite/D1 atomicity.

## Output

`results/02-current-boundary.md`

## Verification

Each proposed edit point must cite a current local file/function.
