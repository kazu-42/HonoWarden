# Packet 01: Route Replay

## Objective

Replay `token/totp-login-success.json` against the Hono app with deterministic
time and seeded TOTP challenge state.

## Ownership

`test/compat/fixture-route-replay.test.ts`.

## Do

- Seed the TOTP challenge hash for `synthetic-two-factor-token`.
- Use fake timers only for the TOTP login fixture.
- Use `allowMutatingFixtures: true` only for this fixture.
- Preserve the default mutating fixture guard.

## Do Not

- Do not edit the fixture request body.
- Do not weaken `isStatelessCompatFixture`.
- Do not touch production code.

## Expected Output

Targeted route replay passes and fake timers are restored after fixture replay.
