# Packet 03: Tests And Docs

## Objective

Make the new gate coverage discoverable in tests and current-state docs.

## Context

The release gate test already asserts representative Week 26 workflow evidence.
It should include the status packet workflow state path.

## Files / Sources

- `test/ops/release-gate.test.ts`
- `docs/current-state.md`
- `.workflow/week-26-release-gate-status-packet-coverage/*`

## Ownership

Main agent.

## Do

- Assert status packet workflow evidence path.
- Document the gate coverage update.

## Do Not

- Claim the release has been published.

## Expected Output

The release gate test fails if the status workflow path is removed from gate
evidence.

## Verification

`pnpm exec vitest run test/ops/release-gate.test.ts`
