# Packet 03: Docs And Workflow

## Objective

Document the release status packet as the top-level state readout.

## Context

The tagging runbook now has separate post-tag, publish, and published packets.
The status packet ties those together for operators.

## Files / Sources

- `docs/release/tagging-runbook.md`
- `docs/current-state.md`
- `test/release-docs.test.ts`
- `.workflow/week-26-release-status-packet/`

## Ownership

Main agent.

## Do

- Add runbook instructions for the status packet.
- Record current status packet behavior.
- Update docs tests so the status packet command stays documented.
- Complete workflow packet and result notes.

## Do Not

- Claim the release has already been published.
- Add external compatibility brand terms to docs.

## Expected Output

Release docs make the status packet discoverable before publication and after
post-publication verification.

## Verification

`pnpm exec vitest run test/release-docs.test.ts`
