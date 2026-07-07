# Orchestration: Week 26 Retention Cleanup Cron Trigger

## Execution Rules

- Keep the task local: source, config, tests, docs, workflow artifacts, git, and
  CI readback only.
- Do not deploy to Cloudflare or mutate live Cron Triggers.
- Preserve normal Hono fetch behavior.
- Keep cleanup idempotent and bounded for at-least-once scheduled delivery.

## Work Packets

### Packet 01: Spark Implementation

Objective: add the scheduled cleanup entrypoint and tests.

Ownership:

- `src/index.ts`
- `src/app.ts`
- `src/maintenance/retention-cleanup.ts`
- `wrangler.jsonc`
- `test/scheduled.test.ts`
- `test/wrangler-environments.test.ts`
- `test/app.test.ts`

Do:

- Move the shared transient auth cleanup logic into a reusable maintenance
  module.
- Keep password-grant cleanup behavior unchanged by using that module from
  `app.ts`.
- Export a Worker object with `fetch` and `scheduled` handlers from
  `src/index.ts`.
- Configure an hourly UTC cron in `wrangler.jsonc` for default, staging, and
  production targets.
- Add focused tests proving scheduled cleanup resolves and config includes the
  cron trigger.

Do not:

- Deploy, write secrets, or call Cloudflare APIs.
- Broaden cleanup scope beyond `auth_attempts`, `auth_failure_buckets`, and
  `totp_challenges`.
- Run broad QA.

### Packet 02: Main Docs And Verification

Objective: document, verify, commit, push, and record CI evidence.

Ownership:

- `docs/current-state.md`
- `docs/operations/retention-cleanup.md`
- `.workflow/week-26-retention-cleanup-cron-trigger/**`

Do:

- Document the scheduled cleanup scope and non-deployed status.
- Review Spark changes and run focused/broad checks.
- Push and record GitHub Actions CI.

Do not:

- Mutate external systems.

## Completion Audit

- Scheduled handler test passes.
- Strict release gate remains ready.
- CI passes after push.
