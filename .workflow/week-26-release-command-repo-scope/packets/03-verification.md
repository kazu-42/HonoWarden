# Packet 03: Verification

## Objective

Verify repo-scoped release command output locally and against the current draft
status.

## Context

The current release remains a draft. The live status packet should remain
`draft_ready_for_publication` while surfacing a repo-scoped publish command.

## Files / Sources

- all touched files
- current GitHub release draft for `v0.1.0-alpha`

## Ownership

Main agent.

## Do

- Run focused tests.
- Run broad local checks.
- Run brand scan and workflow verifier.
- Run the live status packet.

## Do Not

- Publish the release.
- Deploy or mutate external systems.

## Expected Output

Verification evidence recorded in `state.json`, `results/03-verification.md`,
and `final-report.md`.

## Verification

All listed checks pass.
