# Result 02: Release Doc Tests

## Accepted

- Added `test/release-docs.test.ts`.
- Migration freeze hashes are computed from files on disk and checked against
  docs.
- Release notes are tested for alpha warnings and exclusions.

## Rejected

- Did not build a release automation CLI in this slice.
- Did not change GitHub Actions workflow.
