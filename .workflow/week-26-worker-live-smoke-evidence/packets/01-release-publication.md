# Packet 01: Release Publication

## Objective

Record published prerelease evidence for `v0.1.0-alpha`.

## Context

The draft GitHub Release targeted
`e7a3c5ea9e51030143736bb0e7a36cb7a8babfce` and had already passed tag
verification.

## Do

- Publish the draft prerelease after standing approval.
- Verify published state with the release packet, status packet, completion
  audit, and `gh release view`.
- Record non-secret publication proof in release docs.

## Do Not

- Move tags.
- Publish from a different target commit.
- Treat publication as Worker deploy readiness.

## Result

Completed. Published at `2026-07-08T01:37:46Z` and verified as a prerelease at
target commit `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
