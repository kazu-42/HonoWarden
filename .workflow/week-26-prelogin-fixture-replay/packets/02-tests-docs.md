# Packet 02: Tests And Docs

## Objective

Add prelogin fixture route replay and update documentation to match the new
coverage boundary.

## Context

Prelogin already has static fixture coverage and route tests. Replay should
prove the fixture assertions against the Hono route response.

## Files / Sources

- `test/compat/fixture-route-replay.test.ts`
- `docs/current-state.md`
- `docs/compatibility-matrix.md`

## Ownership

Main agent.

## Do

- Add `prelogin/pbkdf2.json` to replay fixtures.
- Update docs from read-only-only wording to deterministic stateless replay.
- Preserve stateful mutation replay as a remaining non-goal.

## Do Not

- Claim token grant, refresh, TOTP, revoke, or mutation replay is complete.
- Promote live client evidence.

## Expected Output

- CI-covered prelogin fixture replay.

## Verification

- `pnpm compat:test` and targeted fixture replay tests pass.
