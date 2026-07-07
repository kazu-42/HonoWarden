# Packet 04: Verification

## Objective

Verify the published packet slice locally and confirm it fails closed against
the current draft release.

## Context

The current GitHub Release remains a draft. The new packet must therefore fail
in strict mode until publication is explicitly approved and performed.

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
- Run the published packet against the real draft and confirm fail-closed
  behavior.

## Do Not

- Publish the release.
- Deploy or mutate external systems.

## Expected Output

Verification evidence recorded in `state.json`, `results/04-verification.md`,
and `final-report.md`.

## Verification

All listed checks pass, and live draft-state strict failure is recorded.
