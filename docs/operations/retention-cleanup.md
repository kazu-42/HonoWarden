# Retention Cleanup

This runbook describes the alpha cleanup path for transient authentication
defense rows, TOTP challenges, and retained audit events.

## Scope

The cleanup path covers:

- `auth_attempts`
- `auth_failure_buckets`
- `totp_challenges`
- `audit_events`

It does not delete users, devices, refresh tokens, folders, ciphers, backup
manifests, or R2 objects.

## Schedule

Cleanup runs from two entrypoints:

- inline maintenance on the password-grant token path
- a Worker scheduled handler configured through Cloudflare Cron Triggers

Each request with a valid `grant_type=password` form and device identifier
triggers one bounded cleanup slice before login-defense bucket lookup.

`wrangler.jsonc` configures the scheduled handler to run hourly in UTC:

```text
0 * * * *
```

The Worker handler and Wrangler configuration are deployed to staging and
production. The live Cron Trigger evidence is recorded in
`docs/release/retention-cron-evidence.md`.

## Bounds

Each cleanup query deletes at most `100` rows per entrypoint execution. This
keeps both the hot path and scheduled Worker execution bounded, and lets
repeated traffic or hourly cron executions drain old rows gradually.

Retention rules:

- auth attempts older than the maximum login-defense window are eligible for
  deletion.
- auth failure buckets older than the maximum login-defense window are eligible
  only when they are not locked, or the lock has already expired.
- TOTP login challenges are eligible when they are expired or already consumed.
- audit events older than 365 days are eligible for deletion when
  `HONOWARDEN_AUDIT_LOGS=true`.

The queries are idempotent. Re-running a cleanup slice after all eligible rows
are gone deletes zero rows. This is required because Cloudflare Cron Triggers
use at-least-once delivery and can rarely run more than once for the same
scheduled time.

## Failure Behavior

Inline cleanup runs inside the same D1-backed token exchange path as
login-defense reads and writes. If inline cleanup fails, the password-grant
request fails with the same structured `database_unavailable` response used for
token exchange failures.

Scheduled cleanup rejects the `waitUntil` task on failure so Cloudflare records
the Cron Event failure and can retry according to platform behavior.

This is intentional for the alpha scope: a missing cleanup table or incompatible
schema means the deployed database is not at the expected migration level.

## Verification

Local checks:

```sh
pnpm test -- test/repositories/auth-repository.test.ts test/repositories/totp-repository.test.ts test/repositories/audit-event-repository.test.ts
pnpm test -- test/app.test.ts test/scheduled.test.ts test/wrangler-environments.test.ts
pnpm check
pnpm lint
pnpm format
```

The repository tests assert that cleanup is bounded, idempotent, does not delete
active login-defense buckets, and deletes audit rows only past the 365-day
retention boundary.

Live checks:

- staging and production D1 schema readback report migrations `0001` through
  `0005` for the recorded HON-51 live evidence; audit-event cleanup is gated by
  `HONOWARDEN_AUDIT_LOGS=true` and requires applying `0007` before audit logging
  is enabled
- staging and production Worker deploy output includes `schedule: 0 * * * *`
- staging and production `/health`, `/healthz`, `/health/db`, and `/api/config`
  pass after deploy
- synthetic prelogin denial remains HTTP `403`
- synthetic `hon-51-cron-smoke` cleanup rows are deleted after the next hourly
  scheduled execution

## Remaining Work

- metrics for rows deleted and cleanup failures
- production migration/deploy evidence for audit-event retention cleanup
- explicit indexes beyond the audit-event incident indexes if production row
  counts justify them
