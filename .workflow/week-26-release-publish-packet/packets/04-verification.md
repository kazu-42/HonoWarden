# Packet 04: Verification

## Objective

Verify the publish packet slice locally and against the current GitHub draft
without publishing it.

## Context

This packet is the final guard before requesting publication approval. It must
prove the implementation, docs, release gate, workflow artifact, and brand scan
are clean.

## Files / Sources

- all touched files
- current GitHub release draft for `v0.1.0-alpha`
- Release Tag Verification run `28863312935`

## Ownership

Main agent.

## Do

- Run focused tests and broad repo checks.
- Run the release gate.
- Run the repository brand scan.
- Run workflow artifact verification.
- Run the publish packet against the real draft.

## Do Not

- Publish the release.
- Deploy or mutate external systems.

## Expected Output

Verification evidence recorded in `state.json`, `results/04-verification.md`,
and `final-report.md`.

## Verification

All listed checks pass, or failures are recorded with exact blockers.
