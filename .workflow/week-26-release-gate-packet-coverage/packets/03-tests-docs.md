# Packet 03: Tests And Docs

## Objective

Document the expanded gate coverage and assert it in tests.

## Files

- `test/ops/release-gate.test.ts`
- `docs/current-state.md`
- `.workflow/week-26-release-gate-packet-coverage/*`

## Do

- Assert both new workflow evidence paths.
- Document that the release gate now includes the approval and post-tag packets.
- Preserve remaining external approval gates.

## Do Not

- Claim a tag or release has been created.

## Expected Output

Tests and docs reflect the updated release gate evidence boundary.
