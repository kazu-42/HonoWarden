# Week 26 Refresh Grant Fixture Replay

## Goal

Replay the existing refresh-grant compatibility fixture against the Hono app so
refresh token rotation coverage exercises the real route.

## Success Criteria

- `token/refresh-grant-success.json` is included in route replay with explicit
  stateful replay opt-in.
- Replay support can seed a refresh-token session without changing FakeD1
  behavior.
- The default mutating fixture guard remains in place.
- Current-state docs describe refresh-grant route replay coverage.
- Local verification and CI pass.

## Current Context

- `refresh_grant` is already part of the fixture flow manifest and client
  matrix.
- `FakeD1Database` already supports `refreshSession` and
  `refreshRotationChanges`.
- Existing app tests prove refresh token rotation with a seeded refresh session.

## Constraints

- Do not publish or edit the GitHub release.
- Do not create, move, delete, or push tags.
- Do not add external compatibility brand names to repo-controlled files.
- Keep stateful replay opt-in narrow.

## Risks

- Refresh grant mutates refresh token and device state; replay must stay
  explicit and isolated.
- Refresh token values are generated; assertions must not depend on exact token
  strings.
- The seeded refresh session must use future expiry and non-revoked device/token
  fields.

## Approval Required

None for local test/docs workflow work. Release publication remains approval
gated.

## Work Packets

- `01-seed-type`: main agent adds refresh-session seed support to fixture replay
  options.
- `02-route-replay`: main agent adds refresh-grant fixture replay with explicit
  mutation opt-in.
- `03-docs-evidence`: main agent updates docs and workflow evidence.

## Integration Policy

No subagent for this slice. Implementation and QA are tightly coupled.

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

This workflow extends the selected stateful fixture replay pattern from
password grant to refresh token rotation.
