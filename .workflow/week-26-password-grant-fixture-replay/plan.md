# Week 26 Password Grant Fixture Replay

## Goal

Replay the existing password-grant compatibility fixture against the Hono app
so token exchange coverage exercises the real route, not only static fixture
shape.

## Success Criteria

- `token/password-grant-success.json` is included in route replay with explicit
  stateful replay opt-in.
- The stateless replay guard remains in place for mutating fixtures by default.
- Current-state docs describe password-grant route replay coverage.
- Workflow evidence records local verification and CI.

## Current Context

- `password_grant` is already part of the fixture flow manifest and client
  matrix.
- Existing route replay covers config, prelogin, sync, profile, revision,
  metadata, devices, folders, and cipher reads.
- App-level tests already prove password grant can run with `FakeD1Database`;
  replay should use the fixture request and assertions as the contract.

## Constraints

- Do not publish or edit the GitHub release.
- Do not create, move, delete, or push tags.
- Do not add external compatibility brand names to repo-controlled files.
- Keep stateful replay opt-in narrow; do not weaken the mutating fixture guard.

## Risks

- Password grant mutates device and refresh-token state, so replay must be
  explicit and isolated.
- Token values are intentionally nondeterministic; fixture assertions must stay
  shape/metadata based, not exact-token based.
- Time-dependent fields should not be asserted exactly.

## Approval Required

None for local test/docs workflow work. Release publication still requires the
exact approval text from the release status packet.

## Work Packets

- `01-route-replay`: main agent adds password-grant fixture replay with
  explicit stateful opt-in.
- `02-docs-evidence`: main agent updates docs and workflow evidence.

## Integration Policy

No subagent for this slice. Implementation and QA are tightly coupled and small.

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

This workflow documents the pattern for promoting selected stateful fixtures to
route replay without weakening the default mutation guard.
