# Packet 03: Docs And Workflow

## Objective

Document the publish packet as a required gate before release publication.

## Context

The tagging runbook already separates tag creation, post-tag verification, and
draft creation. Publication needs the same explicit approval boundary.

## Files / Sources

- `docs/release/tagging-runbook.md`
- `docs/current-state.md`
- `test/release-docs.test.ts`
- `.workflow/week-26-release-publish-packet/`

## Ownership

Main agent.

## Do

- Add runbook instructions for the publish packet.
- Record current draft evidence and publish packet behavior.
- Update docs tests so the packet command stays documented.
- Complete workflow packet and result notes.

## Do Not

- Claim the release has been published.
- Add external compatibility brand terms to docs.

## Expected Output

Release docs require a ready publish packet and explicit operator approval
before the GitHub Release is published.

## Verification

`pnpm exec vitest run test/release-docs.test.ts`
