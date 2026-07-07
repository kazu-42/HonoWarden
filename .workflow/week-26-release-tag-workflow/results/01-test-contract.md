# Result 01: Test Contract

## Accepted

- Added `test/ops/release-tag-workflow.test.ts`.
- The initial focused test failed while `.github/workflows/release-tag.yml` was
  absent.
- The test asserts trigger, permissions, release-critical commands, brand scan,
  and absence of tag mutation commands.
