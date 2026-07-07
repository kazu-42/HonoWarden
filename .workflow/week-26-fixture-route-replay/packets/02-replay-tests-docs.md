# Packet 02: Replay Tests And Docs

## Objective

Add route replay tests for the deterministic fixture subset and document the
coverage boundary.

## Context

The project currently treats fixture rows as static compatibility evidence.
Running implemented fixtures through the app catches drift between fixture JSON
and route behavior.

## Files / Sources

- `test/compat/fixture-route-replay.test.ts`
- `docs/current-state.md`
- `docs/compatibility-matrix.md`

## Ownership

Main agent.

## Do

- Enumerate replayed fixture paths explicitly.
- Assert every selected fixture replays successfully.
- Document read-only/stateless route replay coverage.

## Do Not

- Claim stateful fixture replay is complete.
- Promote non-CLI live compatibility rows.

## Expected Output

- CI-covered route replay tests and documentation.

## Verification

- Targeted compat tests and docs checks pass.
