# Week 13 Revision Conflict Protection

## Goal

Prevent stale folder and cipher updates from overwriting newer server state.

## Success Criteria

- Folder and cipher update requests must include the caller's observed `revisionDate`.
- Update repositories guard writes with the expected revision.
- A missing active record still returns `404`.
- A stale expected revision returns `409 revision_conflict`.
- Existing create, sync, delete, restore, and permanent delete behavior stays unchanged.
- Full local checks and CI pass.

## Current Context

- Week 11 added folder and cipher update routes.
- Week 12 verified opaque cipher payload round-trip and server-owned metadata authority.
- `docs/current-state.md` still lists revision conflict handling as not implemented.

## Constraints

- Do not decrypt, inspect, normalize, or log encrypted cipher payload fields.
- Keep upstream-provider brand strings out of tracked files.
- Keep route handlers thin enough that repository behavior is unit tested directly.
- Do not add migrations, deploy, set real secrets, or touch remote resources beyond normal git/CI.

## Risks

- An update guard that only checks `changes` could collapse stale writes and missing records into `404`.
- Accepting an absent expected revision would leave old clients able to overwrite newer state.
- Storing client metadata in `encrypted_json` must not override server metadata in responses.

## Approval Required

No extra approval is required for local implementation, tests, git push, and CI under the existing sustained-development request. Ask before real secrets, deploys, destructive git, billing, or production data.

## Work Packets

- `01-repository-guards`: add owner-scoped expected-revision update results for folder and cipher repositories.
- `02-route-conflicts`: require update request `revisionDate` and map stale writes to `409 revision_conflict`.
- `03-docs-workflow`: update spec, current-state, and workflow artifacts.
- `04-verification`: run local gates, brand scan, workflow verification, push, and record CI.

## Integration Policy

Do not ship if stale updates are indistinguishable from missing records, if any update path can bypass the expected revision, or if server metadata becomes request-authoritative.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verification
- GitHub Actions CI

## Reusable Artifacts

- `.workflow/week-13-revision-conflict-protection/`
