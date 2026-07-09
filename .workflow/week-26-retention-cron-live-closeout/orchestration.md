# Orchestration: Week 26 Retention Cron Live Closeout

## Sequence

1. Confirm HON-51 scope and move it to In Progress.
2. Run focused retention/scheduled tests and release gate locally.
3. Inspect release-target drift and identify that current `main` deploy carries
   post-alpha runtime changes beyond Cron.
4. Apply additive D1 migrations to staging.
5. Deploy staging and verify health.
6. Apply additive D1 migrations to production.
7. Deploy production and verify health.
8. Insert synthetic `hon-51-cron-smoke` cleanup rows in staging and production.
9. Wait for the next hourly Cron Trigger.
10. Verify synthetic cleanup rows are deleted.
11. Update evidence docs and Linear, then close the issue.

## Integration Rules

- Staging must pass before production.
- Production must not be marked complete until `/health/db` reports schema
  version `0005` and synthetic cleanup rows are deleted by scheduled execution.
- Evidence may include public Worker/resource names, deployment IDs, version IDs,
  timestamps, route paths, and row counts.
- Evidence must not include account emails, private user data, token values, API
  keys, or secret values.

## Rollback Boundary

D1 migrations `0004` and `0005` are additive and remain in place. Runtime
rollback uses Worker versions; trigger disable uses a hotfix deploy that removes
`triggers.crons` for the target environment.
