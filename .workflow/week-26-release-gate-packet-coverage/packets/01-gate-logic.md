# Packet 01: Gate Logic

## Objective

Add completed packet workflows to the release gate evidence list.

## Files

- `scripts/honowarden-release-gate.mjs`
- `test/ops/release-gate.test.ts`

## Do

- Require `week-26-release-approval-packet`.
- Require `week-26-post-tag-release-packet`.
- Assert both state paths are present in release gate test evidence.

## Do Not

- Add this current coverage workflow to the required list.
- Change release gate readiness semantics.

## Expected Output

Release gate workflow evidence covers the latest completed release packet
workflows.
