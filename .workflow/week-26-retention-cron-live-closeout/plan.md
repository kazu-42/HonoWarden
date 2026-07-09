# Week 26 Retention Cron Live Closeout

## Goal

Close HON-51 by deploying the retention cleanup Cron Trigger to live Cloudflare
environments and recording redacted monitoring evidence.

## Success Criteria

- Staging and production D1 migrations `0004` and `0005` are applied.
- Staging and production Workers are deployed from a reviewed source commit.
- Deploy output/readback includes schedule `0 * * * *`.
- Health smoke passes after each deploy.
- Synthetic cleanup rows are removed by the next scheduled execution.
- Rollback and disable procedure is documented.
- Linear HON-51 is updated and moved to Done after evidence passes.

## Current Context

- The repository already had local scheduled handler implementation and hourly
  cron configuration.
- Prior workflow `.workflow/week-26-retention-cleanup-cron-trigger` was local
  implementation only and intentionally did not deploy Cloudflare changes.
- HON-51 asks for live deploy plus monitoring evidence.

## Constraints

- Keep cleanup scope limited to transient auth tables.
- Do not delete real user, vault, device, refresh-token, folder, cipher, backup,
  audit, R2, or inquiry inbox data.
- Do not record account emails, API keys, token values, Cloudflare secret
  values, or real user data.
- Treat D1 migrations `0004` and `0005` as forward-only additive changes.

## Risks

- Deploying current `main` includes runtime changes after the alpha release
  target, not only the Cron Trigger.
- Cron Triggers are at-least-once, so cleanup must be idempotent and bounded.
- Rolling back Worker code does not roll back additive D1 columns.

## Work Packets

- `01-staging-deploy`: migrate and deploy staging, then smoke test.
- `02-production-deploy`: migrate and deploy production, then smoke test.
- `03-cron-readback`: insert synthetic cleanup rows and verify scheduled
  deletion.
- `04-docs-linear-closeout`: record evidence, pass checks, merge PR, and close
  HON-51.

## Verification

- `pnpm exec vitest run test/scheduled.test.ts test/wrangler-environments.test.ts test/app.test.ts test/repositories/auth-repository.test.ts test/repositories/totp-repository.test.ts`
- `pnpm check`
- `pnpm release:gate -- --strict`
- `wrangler deploy --dry-run` for staging and production
- D1 migration list/readback
- staging and production deploy output
- staging and production health smoke
- synthetic cleanup row readback before and after scheduled execution
- workflow verifier
- docs tests
- secret/email scan
