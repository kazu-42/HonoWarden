# Result 03: Docs And Workflow

## Accepted

- Updated `docs/release/tagging-runbook.md` to require
  `pnpm release:publish:packet -- --strict` before publication.
- Updated `docs/current-state.md` with draft evidence and publish packet state.
- Updated release docs tests to keep the publish packet command documented.
- Added workflow packet notes for the release publication gate.

## Rejected

- Docs do not claim the GitHub Release has been published.
- Docs do not authorize deployment from the release.

## Evidence

- `pnpm exec vitest run test/release-docs.test.ts`
