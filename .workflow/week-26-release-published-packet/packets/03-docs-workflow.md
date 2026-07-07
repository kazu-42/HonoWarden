# Packet 03: Docs And Workflow

## Objective

Document the published packet as a required post-publication verification gate.

## Context

The tagging runbook separates tag creation, draft creation, and publication.
Post-publication verification needs the same explicit boundary before any
deployment discussion.

## Files / Sources

- `docs/release/tagging-runbook.md`
- `docs/current-state.md`
- `test/release-docs.test.ts`
- `.workflow/week-26-release-published-packet/`

## Ownership

Main agent.

## Do

- Add runbook instructions for the published packet.
- Record current published packet behavior.
- Update docs tests so the packet command stays documented.
- Complete workflow packet and result notes.

## Do Not

- Claim the release has already been published.
- Add external compatibility brand terms to docs.

## Expected Output

Release docs require a ready published packet after GitHub Release publication.

## Verification

`pnpm exec vitest run test/release-docs.test.ts`
