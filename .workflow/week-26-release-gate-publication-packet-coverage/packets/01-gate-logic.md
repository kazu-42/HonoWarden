# Packet 01: Gate Logic

## Objective

Add completed release publication packet workflows to the release gate evidence
list.

## Context

The release gate already requires the release approval and post-tag packet
workflow states. The publish and published verifier workflows landed later and
should now be required too.

## Files / Sources

- `scripts/honowarden-release-gate.mjs`

## Ownership

Main agent.

## Do

- Require `week-26-release-publish-packet`.
- Require `week-26-release-published-packet`.

## Do Not

- Add this current coverage workflow to the required list.
- Change unrelated release gate checks.

## Expected Output

Release gate workflow evidence covers all completed release packet workflows.

## Verification

`pnpm release:gate -- --strict`
