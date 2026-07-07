# Packet 01: Replay Helper

## Objective

Add a deterministic helper for replaying selected compatibility fixtures against
the Hono app.

## Context

- Static fixture validation already checks fixture response bodies.
- Read-only routes can be replayed with `FakeD1Database` and a synthetic access
  token.
- Stateful mutation fixtures need sequencing and are out of this slice.

## Files / Sources

- `test/compat/fixture-replay-support.ts`
- `test/support/fake-d1.ts`
- `src/app.ts`
- `compat/fixtures/**/*.json`

## Ownership

Main agent owns final integration. Spark may contribute this helper only.

## Do

- Load fixture JSON by relative fixture path.
- Replace `Bearer synthetic-access-token` with a signed test token.
- Set a deterministic `X-Request-Id`.
- Seed synthetic user, folder, and cipher rows for read-only routes.
- Validate fixture assertions against actual route JSON.

## Do Not

- Replay mutating fixtures.
- Modify production app behavior.
- Add external compatibility brand strings.

## Expected Output

- A typed helper that route replay tests can import.

## Verification

- Targeted compat replay tests pass.
