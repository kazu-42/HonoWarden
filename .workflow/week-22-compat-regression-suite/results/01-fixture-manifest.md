# Result 01: Fixture Manifest

## Accepted

- Added `compat/fixture-flows.json`.
- Added `sync_with_items` to each matrix row.
- Added a compatibility test that verifies every manifest fixture path exists.
- Kept the matrix conservative at `fixture_only`.

## Rejected

- Did not promote any client surface to live verification.
- Did not rely on `knownIssues` as a substitute for missing fixture evidence.
