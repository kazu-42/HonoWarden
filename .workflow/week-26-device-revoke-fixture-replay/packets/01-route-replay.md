# Packet 01: Route Replay

## Objective

Replay `devices/revoke-success.json` against the Hono app with deterministic
owner and mutation seed state.

## Ownership

- `test/compat/fixture-route-replay.test.ts`
- `test/compat/fixture-replay-support.ts`

## Do

- Expose `deviceRevokeChanges` through the route replay database seed.
- Use `deviceReplayUser` so the token subject matches fixture path owner
  `user-id`.
- Add the fixture with `allowMutatingFixtures: true`.
- Preserve the default mutating fixture guard.

## Do Not

- Do not edit the fixture request or response.
- Do not weaken `isStatelessCompatFixture`.
- Do not touch production code.

## Expected Output

Targeted route replay passes, including the default guard test.
