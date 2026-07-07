# Packet 01: Route Replay

## Objective

Replay `token/totp-challenge.json` against the Hono app with explicit stateful
replay opt-in.

## Ownership

`test/compat/fixture-route-replay.test.ts`.

## Do

- Seed a TOTP-enabled synthetic user.
- Add the TOTP challenge fixture to route replay.
- Use `allowMutatingFixtures: true` only for this fixture.
- Preserve the default mutating fixture guard.

## Do Not

- Do not implement or claim TOTP login success replay.
- Do not weaken `isStatelessCompatFixture`.
- Do not touch production code.

## Expected Output

Targeted route replay passes and verifies the challenge response assertions.
