# Packet 01: Route Replay

## Objective

Replay `token/password-grant-success.json` against the Hono app with explicit
stateful replay opt-in.

## Ownership

`test/compat/fixture-route-replay.test.ts`.

## Do

- Add the password-grant fixture to the replay list.
- Use `allowMutatingFixtures: true` only for that fixture.
- Preserve the existing default mutating fixture guard.

## Do Not

- Do not weaken `isStatelessCompatFixture`.
- Do not require exact generated token values.
- Do not touch release, tag, deploy, DNS, email, or secrets.

## Expected Output

Targeted route replay passes and the default guard test still rejects mutating
fixtures without opt-in.
