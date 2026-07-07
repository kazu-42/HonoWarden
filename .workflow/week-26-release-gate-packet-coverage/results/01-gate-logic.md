# Result 01: Gate Logic

## Accepted

- Added the release approval packet workflow to `requiredWorkflowSlugs`.
- Added the post-tag release packet workflow to `requiredWorkflowSlugs`.
- Updated release gate tests to assert both evidence paths.

## Notes

- The current coverage workflow is intentionally excluded to avoid a CI
  self-reference loop.
