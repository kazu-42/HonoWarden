# Packet 01: Stateless Classification

## Objective

Allow deterministic prelogin POST fixtures in route replay without weakening the
default protection against stateful mutation fixtures.

## Context

The replay helper currently treats only GET fixtures as stateless. Prelogin is a
client discovery request and does not mutate server state.

## Files / Sources

- `test/compat/fixture-replay-support.ts`
- `compat/fixtures/prelogin/pbkdf2.json`

## Ownership

Spark owns the helper-only change. Main agent owns integration review.

## Do

- Keep GET fixtures allowed.
- Add explicit stateless allowance for prelogin POST paths.
- Keep all other non-GET fixtures refused by default.

## Do Not

- Modify production app behavior.
- Replay token grant or mutation fixtures.
- Add external compatibility brand strings.

## Expected Output

- Helper classification supports deterministic prelogin replay.

## Verification

- Targeted compatibility replay tests pass.
