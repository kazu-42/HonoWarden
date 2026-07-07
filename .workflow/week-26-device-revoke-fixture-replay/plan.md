# Week 26 Device Revoke Fixture Replay

## Goal

Replay the existing device revoke success compatibility fixture against the Hono
app with deterministic authenticated user and mutation seed behavior.

## Success Criteria

- `devices/revoke-success.json` is included in route replay with explicit
  stateful replay opt-in.
- The replay token subject matches the fixture path owner `user-id`.
- The current device remains `fixture-device` and target device remains
  `user-id:other-device`.
- The default mutating fixture guard remains in place.
- Current-state docs describe device revoke route replay coverage.
- Local verification and CI pass.

## Current Context

- Device list, identifier, and known-device fixtures are already route-replayed.
- Device revoke API and fixture already exist.
- `FakeD1Database` already models successful device revoke updates, but the
  route replay seed type does not expose the `deviceRevokeChanges` knob.

## Constraints

- Do not publish or edit the GitHub release.
- Do not create, move, delete, or push tags.
- Do not add external compatibility brand names to repo-controlled files.
- Do not edit the fixture request or response body.
- Do not weaken the default mutating fixture guard.

## Risks

- If the route replay signs the token for the default user instead of `user-id`,
  the owner-scoped device revoke path becomes inconsistent.
- If the target device equals the current token device, the route correctly
  rejects self-revoke.
- This fixture mutates session state, so replay must stay explicitly opted in.

## Approval Required

None for local test/docs workflow work. Release publication remains approval
gated.

## Work Packets

- `01-route-replay`: add device revoke seed support and include the fixture in
  route replay.
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

This workflow documents how to replay authenticated stateful device mutations
with a scoped fake database mutation count and synthetic token replacement.
