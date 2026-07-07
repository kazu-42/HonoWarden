# Result 03: Docs And Workflow

## Accepted

- Updated `docs/release/tagging-runbook.md` to require
  `pnpm release:published:packet -- --strict` after publication.
- Updated `docs/current-state.md` with published packet behavior.
- Updated release docs tests to keep the published packet command documented.
- Added workflow packet notes for the post-publication verification gate.

## Rejected

- Docs do not claim the GitHub Release has already been published.
- Docs do not authorize deployment from the release.

## Evidence

- `pnpm exec vitest run test/release-docs.test.ts`
