# Packet 01: Fixture Replay

## Objective

Add and route-replay `devices/revoke-all-success.json` with deterministic
recent-auth token timing.

## Ownership

- `compat/fixtures/devices/revoke-all-success.json`
- `test/compat/fixture-route-replay.test.ts`

## Do

- Capture the successful `POST /api/devices/revoke-all` response contract.
- Use explicit `allowMutatingFixtures: true`.
- Use fixed system time and token `iat`/`exp` claims so recent-auth validation
  is deterministic.
- Preserve the default mutating fixture guard.

## Do Not

- Do not change route behavior only to satisfy the fixture.
- Do not weaken recent-auth validation.

## Expected Output

Targeted route replay passes.
