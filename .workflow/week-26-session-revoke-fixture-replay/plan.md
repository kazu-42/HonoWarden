# Week 26 Session Revoke Fixture Replay

## Goal

Add and route-replay a session revoke-all compatibility fixture for
`POST /api/devices/revoke-all`.

## Success Criteria

- `devices/revoke-all-success.json` captures the successful revoke-all response
  contract.
- The new fixture is included in route replay with explicit stateful replay
  opt-in.
- Route replay can generate a recent password-authenticated synthetic token with
  deterministic time.
- `session_revoke` is added to fixture flow tracking and every matrix row.
- Current-state docs no longer list revoke-all fixture replay as missing.
- Local verification and CI pass.

## Current Context

- Single-device revoke fixture is already route-replayed.
- The revoke-all route requires a recent password-authenticated access token.
- Route replay already supports scoped fake system time; it needs to pass token
  issue/expiry options from fixture entries to the replay harness.

## Constraints

- Do not publish or edit the GitHub release.
- Do not create, move, delete, or push tags.
- Do not add external compatibility brand names to repo-controlled files.
- Do not change the route contract only to fit a fixture.

## Risks

- Recent-auth validation depends on `Date.now()`, token `iat`, and token `exp`.
- Matrix and fixture-flow manifests must stay in lockstep.
- This fixture mutates session/device state, so replay must stay explicitly
  opted in.

## Approval Required

None for local fixture/test/docs workflow work. Release publication remains
approval gated.

## Work Packets

- `01-fixture-replay`: add the revoke-all fixture and replay entry with
  deterministic recent-auth token timing.
- `02-manifest-docs-evidence`: update flow manifest, matrix, docs, and evidence.

## Integration Policy

No subagent for this slice. The change is narrow and QA-coupled.

## Verification

- Targeted route replay tests.
- `pnpm compat:test`
- matrix tests.
- workflow verifier.
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- repository policy external-brand scan.
- release gate/status/completion audit.
- GitHub Actions CI after push.

## Reusable Artifacts

This workflow documents how to route-replay recent-auth fixtures with fixed
system time and token issue/expiry claims.
