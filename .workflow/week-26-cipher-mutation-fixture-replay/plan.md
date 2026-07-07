# Week 26 Cipher Mutation Fixture Replay

## Goal

Replay the existing cipher mutation and revision-conflict compatibility fixtures
against the Hono app with explicit stateful replay opt-in.

## Success Criteria

- Cipher create, update, trash, restore, and permanent delete fixtures are
  included in route replay.
- `errors/revision-conflict.json` is included in route replay against the real
  cipher update route.
- Cipher mutation fixtures remain explicit opt-ins and do not weaken the default
  mutating fixture guard.
- Cipher trash/permanent-delete route semantics match the existing compatibility
  fixtures.
- Route replay seed support exposes only the existing FakeD1 cipher mutation
  knobs needed by these fixtures.
- Current-state docs describe cipher mutation and revision-conflict route replay
  coverage.
- Local verification and CI pass.

## Current Context

- Cipher list and get fixtures are already route-replayed.
- Cipher mutation APIs and compatibility fixtures already exist.
- FakeD1 already models cipher insert, update, soft delete, restore, permanent
  delete, and conflict outcomes; route replay seed typing currently does not
  expose all of those knobs.

## Constraints

- Do not publish or edit the GitHub release.
- Do not create, move, delete, or push tags.
- Do not add external compatibility brand names to repo-controlled files.
- Do not edit fixture request or response bodies.
- Do not weaken the stateless replay guard.

## Risks

- Create and update fixtures with `folderId` require folder ownership seed.
- Revision-conflict replay requires a current cipher row and update changes set
  to zero.
- These fixtures are stateful mutations; they must stay explicit opt-ins.
- The existing app route mapped `DELETE /api/ciphers/:id` to permanent delete,
  while the fixture expects trash; route semantics must be aligned without
  removing the legacy `PUT /api/ciphers/:id/delete` trash route.

## Approval Required

None for local test/docs workflow work. Release publication remains approval
gated.

## Work Packets

- `01-route-replay`: add cipher mutation seed support and include the mutation
  and revision-conflict fixtures in route replay.
- `02-docs-evidence`: update docs and workflow evidence.

## Integration Policy

No subagent for this slice. The change is QA-coupled and narrow.

## Verification

- Targeted route replay tests.
- `pnpm compat:test`
- workflow verifier.
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- repository policy external-brand scan.
- release gate/status/completion audit.
- GitHub Actions CI after push.

## Reusable Artifacts

This workflow documents how to route-replay cipher mutations and conflict
fixtures using narrow FakeD1 mutation-count and row seeds, and how to treat a
fixture mismatch as a route semantics bug when the fixture captures the intended
client-facing behavior.
