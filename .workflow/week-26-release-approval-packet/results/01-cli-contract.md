# Result 01: CLI Contract

## Accepted

- Added `scripts/honowarden-release-approval-packet.mjs`.
- Added `release:approval:packet` to `package.json`.
- The report includes `schemaVersion`, `status`, `targetTag`,
  `targetVersion`, `targetCommit`, `ci`, `checks`, `commands`,
  `approvalText`, and `limitations`.
- Provided CI run IDs are verified with `gh run view` and must be completed
  successfully for the target commit.

## Notes

- The script shells out to existing release scripts rather than duplicating
  release readiness logic.
- Strict mode fails when the final packet is not ready.
