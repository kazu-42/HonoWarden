# Packet 01: Route Replay

## Objective

Replay folder create, update, and delete compatibility fixtures against the Hono
app with explicit stateful opt-in.

## Ownership

- `test/compat/fixture-route-replay.test.ts`
- `test/compat/fixture-replay-support.ts`

## Do

- Expose `folderUpdateChanges` and `folderDeleteChanges` through route replay
  database seed.
- Add `folders/create-success.json`, `folders/update-success.json`, and
  `folders/delete-success.json` with `allowMutatingFixtures: true`.
- Preserve the default mutating fixture guard.

## Do Not

- Do not edit fixture payloads.
- Do not weaken `isStatelessCompatFixture`.
- Do not touch production code.

## Expected Output

Targeted route replay passes, including the default guard test.
