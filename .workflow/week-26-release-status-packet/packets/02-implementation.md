# Packet 02: Implementation

## Objective

Add a read-only release status packet script and package script.

## Context

The script should aggregate the existing publish and published packets rather
than duplicating every release check.

## Files / Sources

- `scripts/honowarden-release-status-packet.mjs`
- `package.json`

## Ownership

Main agent.

## Do

- Run the publish and published packets without strict mode.
- Derive the release phase from their reports.
- Emit next action, approval text, and commands appropriate to the phase.
- Exit non-zero in `--strict` mode only when no actionable ready phase exists.

## Do Not

- Run `gh release edit`.
- Create, move, delete, or push Git tags.
- Deploy or mutate Cloudflare state.

## Expected Output

`pnpm release:status:packet` produces a ready/not-ready JSON report.

## Verification

`pnpm release:status:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>`
