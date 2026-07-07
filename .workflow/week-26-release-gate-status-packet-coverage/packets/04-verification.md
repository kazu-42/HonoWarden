# Packet 04: Verification

## Objective

Verify the release gate status packet coverage locally and with CI readback.

## Context

The modified release gate now depends on the release status packet workflow
state. It must be completed, passed, and backed by a successful CI run.

## Files / Sources

- all touched files
- GitHub Actions run `28865069916`

## Ownership

Main agent.

## Do

- Run focused release gate test.
- Run strict release gate.
- Run broad local checks.
- Run brand scan and workflow verifier.
- Read back the CI run.

## Do Not

- Publish the GitHub Release.
- Deploy or mutate external systems.

## Expected Output

Local checks pass, CI run reads back as successful, and this workflow records
verification evidence.

## Verification

All listed checks pass.
