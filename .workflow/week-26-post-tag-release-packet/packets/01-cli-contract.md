# Packet 01: CLI Contract

## Objective

Create a read-only post-tag packet for release draft readiness.

## Files

- `scripts/honowarden-post-tag-release-packet.mjs`
- `package.json`

## Do

- Verify local tag context, remote tag context, tag workflow evidence, release
  planning, and release state.
- Emit candidate release draft commands from the existing release plan.
- Emit exact release draft approval text.

## Do Not

- Create, move, delete, or push tags.
- Create, update, publish, or delete GitHub releases.
- Deploy.

## Expected Output

`pnpm release:post-tag:packet` prints a machine-readable report with readiness
checks, commands, limitations, and approval text.
