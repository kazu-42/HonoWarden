# Packet 04: Verification

## Objective

Verify the status packet slice locally and against the current GitHub draft.

## Context

The current release is a draft prerelease. The live status packet should report
`draft_ready_for_publication` and emit the publication approval text.

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
- Run the status packet against the real draft.

## Do Not

- Publish the release.
- Deploy or mutate external systems.

## Expected Output

Verification evidence recorded in `state.json`, `results/04-verification.md`,
and `final-report.md`.

## Verification

All listed checks pass, and live draft-ready status is recorded.
