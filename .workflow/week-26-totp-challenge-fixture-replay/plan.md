# Week 26 TOTP Challenge Fixture Replay

## Goal

Replay the existing TOTP challenge compatibility fixture against the Hono app
so primary-password success with a TOTP-enabled user exercises the real token
route.

## Success Criteria

- `token/totp-challenge.json` is included in route replay with explicit
  stateful replay opt-in.
- The replay seeds a TOTP-enabled user and non-empty encrypted TOTP secret.
- The default mutating fixture guard remains in place.
- Current-state docs describe TOTP challenge route replay coverage while keeping
  TOTP login as remaining work.
- Local verification and CI pass.

## Current Context

- `totp_login` fixture flow already contains `token/totp-challenge.json` and
  `token/totp-login-success.json`.
- Password grant and refresh grant fixtures are already route-replayed with
  explicit stateful opt-in.
- Existing app tests prove TOTP challenge issuance with `FakeD1Database`.

## Constraints

- Do not publish or edit the GitHub release.
- Do not create, move, delete, or push tags.
- Do not add external compatibility brand names to repo-controlled files.
- Keep stateful replay opt-in narrow.

## Risks

- TOTP challenge issuance mutates `totp_challenges`; replay must stay explicit.
- TOTP login success needs a time-dependent code and is intentionally separate.
- The seed must avoid secret leakage and only use synthetic test values.

## Approval Required

None for local test/docs workflow work. Release publication remains approval
gated.

## Work Packets

- `01-route-replay`: main agent adds TOTP challenge fixture replay with a
  deterministic synthetic TOTP-enabled user seed.
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

This workflow documents the pattern for replaying challenge-style token flows
that return expected `invalid_grant` responses with out-of-band continuation
data.
