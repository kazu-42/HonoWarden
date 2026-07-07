# Week 26 TOTP Login Fixture Replay

## Goal

Replay the existing TOTP login success compatibility fixture against the Hono
app using deterministic test time and seeded challenge state.

## Success Criteria

- `token/totp-login-success.json` is included in route replay with explicit
  stateful replay opt-in.
- Replay uses a deterministic synthetic TOTP-enabled user, challenge hash, and
  fixed system time where fixture code `123456` is valid.
- The default mutating fixture guard remains in place.
- Current-state docs describe TOTP login route replay coverage.
- Local verification and CI pass.

## Current Context

- TOTP challenge fixture is already route-replayed.
- TOTP login fixture request contains static `twoFactorCode: 123456`.
- For the synthetic secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`, code `123456`
  is valid at `1970-05-06T05:26:30.000Z`.

## Constraints

- Do not publish or edit the GitHub release.
- Do not create, move, delete, or push tags.
- Do not add external compatibility brand names to repo-controlled files.
- Keep stateful replay opt-in narrow.
- Do not edit the fixture request to hide the time dependency.

## Risks

- Fake timers must be scoped to this fixture so other replay cases do not
  inherit old time.
- The seeded challenge hash must match `synthetic-two-factor-token` under the
  replay token secret.
- This flow consumes challenge state and creates a session; replay must stay
  explicit.

## Approval Required

None for local test/docs workflow work. Release publication remains approval
gated.

## Work Packets

- `01-route-replay`: main agent adds TOTP login fixture replay with deterministic
  time and challenge seed.
- `02-docs-evidence`: main agent updates docs and workflow evidence.

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

This workflow documents how to route-replay time-dependent token fixtures without
changing fixture request bodies.
