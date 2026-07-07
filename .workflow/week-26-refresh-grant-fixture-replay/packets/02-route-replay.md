# Packet 02: Route Replay

## Objective

Replay `token/refresh-grant-success.json` against the Hono app with explicit
stateful replay opt-in.

## Ownership

`test/compat/fixture-route-replay.test.ts`.

## Do

- Add a deterministic refresh-session seed.
- Add the refresh-grant fixture to the replay list.
- Use `allowMutatingFixtures: true` only for this fixture.
- Keep the default mutating fixture guard.

## Do Not

- Do not assert exact generated access or refresh token strings.
- Do not weaken `isStatelessCompatFixture`.

## Expected Output

Targeted route replay passes.
