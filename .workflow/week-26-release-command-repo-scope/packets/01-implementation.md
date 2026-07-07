# Packet 01: Implementation

## Objective

Add explicit repository scope to emitted GitHub Release commands.

## Context

Operator commands may be copied outside the repository working tree. `gh`
commands should therefore specify `--repo kazu-42/HonoWarden`.

## Files / Sources

- `scripts/honowarden-github-release-plan.mjs`
- `scripts/honowarden-release-publish-packet.mjs`
- `scripts/honowarden-release-published-packet.mjs`
- `scripts/honowarden-release-status-packet.mjs`

## Ownership

Main agent.

## Do

- Add repo scope to create/view/publish command strings.
- Keep command generation read-only.

## Do Not

- Run `gh release edit`.
- Create, move, delete, or push Git tags.

## Expected Output

All operator-facing GitHub Release command strings include
`--repo kazu-42/HonoWarden`.

## Verification

Focused packet tests.
