# Packet 04: Verification

## Objective

Verify the release gate publication packet coverage locally and with CI
readback.

## Context

The modified release gate now depends on two newer workflow state files. Both
must be completed, passed, and backed by successful CI runs.

## Files / Sources

- all touched files
- GitHub Actions runs `28864040079` and `28864381009`

## Ownership

Main agent.

## Do

- Run focused release gate test.
- Run strict release gate.
- Run broad local checks.
- Run brand scan and workflow verifier.
- Read back both CI runs.

## Do Not

- Publish the GitHub Release.
- Deploy or mutate external systems.

## Expected Output

Local checks pass, both CI runs read back as successful, and this workflow
records verification evidence.

## Verification

All listed checks pass.
