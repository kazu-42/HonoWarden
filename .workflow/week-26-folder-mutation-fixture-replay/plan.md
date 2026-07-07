# Week 26 Folder Mutation Fixture Replay

## Goal

Replay the existing folder create, update, and delete compatibility fixtures
against the Hono app with explicit stateful replay opt-in.

## Success Criteria

- `folders/create-success.json`, `folders/update-success.json`, and
  `folders/delete-success.json` are included in route replay.
- Folder mutation fixtures remain explicitly opted in and do not weaken the
  default mutating fixture guard.
- Route replay seed support exposes only the existing FakeD1 folder mutation
  knobs required by these fixtures.
- Current-state docs describe folder mutation route replay coverage.
- Local verification and CI pass.

## Current Context

- Folder list and get fixtures are already route-replayed.
- Folder create/update/delete APIs and compatibility fixtures already exist.
- FakeD1 already models folder insert, update, and delete outcomes; route replay
  seed typing currently does not expose update/delete mutation counts.

## Constraints

- Do not publish or edit the GitHub release.
- Do not create, move, delete, or push tags.
- Do not add external compatibility brand names to repo-controlled files.
- Do not edit fixture request or response bodies.
- Do not weaken the stateless replay guard.

## Risks

- These fixtures are stateful mutations; they must stay explicit opt-ins.
- Update/delete success depends on the FakeD1 change count being one.
- Date values are generated at runtime, so assertions must stay shape-based.

## Approval Required

None for local test/docs workflow work. Release publication remains approval
gated.

## Work Packets

- `01-route-replay`: add folder mutation seed support and include create,
  update, and delete fixtures in route replay.
- `02-docs-evidence`: update docs and workflow evidence.

## Integration Policy

No subagent for this slice. The change is small and QA-coupled.

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

This workflow documents how to route-replay simple mutation fixtures by exposing
narrow FakeD1 mutation-count seed knobs without changing fixture payloads.
