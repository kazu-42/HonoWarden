# Result 02: Script

## Accepted

- Added `scripts/honowarden-github-release-plan.mjs`.
- Added `pnpm release:github:plan`.
- The script validates package version, release notes, local tag context, and
  optional remote tag context.
- The script emits `gh release create ... --draft --prerelease --verify-tag`.

## Rejected

- Did not create a GitHub release draft.
- Did not publish a GitHub release.
- Did not create or push a tag.
