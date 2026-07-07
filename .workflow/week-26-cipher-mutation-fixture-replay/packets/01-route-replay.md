# Packet 01: Route Replay

## Objective

Replay cipher mutation and revision-conflict compatibility fixtures against the
Hono app with explicit stateful opt-in.

## Ownership

- `test/compat/fixture-route-replay.test.ts`
- `test/compat/fixture-replay-support.ts`

## Do

- Expose cipher mutation-count seed knobs through route replay database seed.
- Add create, update, trash, restore, permanent delete, and revision-conflict
  fixtures with `allowMutatingFixtures: true`.
- Seed folder ownership for create/update fixtures that reference `folder-id`.
- Seed a current cipher row for revision-conflict replay.
- Align trash/permanent-delete route semantics when fixture replay exposes a
  mismatch.
- Preserve the default mutating fixture guard.

## Do Not

- Do not edit fixture payloads.
- Do not weaken `isStatelessCompatFixture`.
- Do not touch unrelated production code.

## Expected Output

Targeted route replay passes, including the default guard test.
