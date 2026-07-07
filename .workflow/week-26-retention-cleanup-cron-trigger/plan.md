# Week 26 retention cleanup cron trigger

## Goal

Add a Cloudflare Cron Trigger entrypoint for bounded transient auth cleanup so
stale auth-defense and TOTP challenge rows can be drained even when
password-grant traffic is absent.

## Success Criteria

- Existing password-grant inline cleanup reuses shared maintenance code.
- Worker default export supports both `fetch` and `scheduled` handlers.
- `wrangler.jsonc` defines an hourly UTC cron for default, staging, and
  production deploy targets.
- Tests cover the scheduled handler and wrangler cron configuration.
- Local checks, workflow verifier, brand scan, and GitHub Actions CI pass.

## Current Context

- `cleanupAuthDefenseState` and `cleanupExpiredTotpChallenges` are already
  bounded and idempotent.
- Inline cleanup currently runs only on the password-grant token path.
- Cloudflare Cron Triggers are UTC-only and at-least-once, so the scheduled task
  must remain idempotent.

## Constraints

- Do not deploy, create Cloudflare resources, mutate DNS/email, or write
  secrets.
- Do not touch release publication/tag state.
- Keep the cleanup row cap at the existing `100` rows per query unless tests
  prove a deliberate change.
- Keep tracked content free of the external compatibility-provider brand token.

## Risks

- Exporting a scheduled handler incorrectly could break normal Hono fetch
  routing.
- Cron triggers can run at least once, so duplicate executions must be safe.
- The local `/__scheduled` test endpoint should not expose a production trigger
  path through normal fetch routing.

## Approval Required

No approval required for local code, tests, docs, workflow artifacts, commit,
push, and CI readback. Cloudflare deploy and live trigger mutation remain
approval-gated.

## Work Packets

1. Spark implementation packet
   - Own Worker entrypoint, shared cleanup module, cron config, and focused
     tests.
2. Main docs and verification packet
   - Own current-state, retention cleanup runbook, workflow artifacts, QA,
     commit/push, and CI readback.

## Integration Policy

Prefer sharing the existing cleanup function between HTTP and scheduled paths
over duplicating retention-window math. Scheduled handler errors should reject
the `waitUntil` promise so Cloudflare records failure and can retry.

## Verification

- Focused scheduled/wrangler/app tests.
- `pnpm release:gate -- --strict`
- `pnpm brand:scan`
- workflow verifier
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- GitHub Actions CI readback

## Reusable Artifacts

- `.workflow/week-26-retention-cleanup-cron-trigger`
