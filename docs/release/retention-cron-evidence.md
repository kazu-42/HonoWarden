# Retention Cron Evidence

> **HISTORICAL EVIDENCE — NOT CURRENT EXECUTION AUTHORITY.** This document
> records the 2026-07 retention-cron deployment and its then-live observations.
> It does not establish current deployment, cron, schema, health, or rollback
> state, and it does not authorize a Worker upload, activation, rollback, trigger
> change, or traffic change. Current Worker recovery remains STOP unless a future
> remote-write protocol satisfies the admission boundary in
> [Build provenance and deployment authority](../operations/deploy-provenance-runbook.md#admission-requirements-for-a-future-remote-write-protocol)
> and receives separate, one-shot authority.

Historical status: passed.

Historical readback: 2026-07-09T16:03:22Z.

This file recorded the then-live Cloudflare closeout for the transient auth
retention cleanup Cron Trigger. It intentionally recorded only deployment IDs,
Worker version IDs, schema versions, synthetic cleanup row counts, and redacted
health-smoke results.

Account emails, API keys, token values, private mailbox destinations, real user
data, vault contents, and Cloudflare secret values were not recorded here.

## Scope

The observed cleanup path covered only transient authentication tables:

- `auth_attempts`
- `auth_failure_buckets`
- `totp_challenges`

It did not delete users, devices, folders, ciphers, audit log lines, backup
manifests, R2 objects, or inquiry inbox data during the recorded exercise.

A later policy note, added 2026-07-13, stated that refresh-token history
retention was separately gated by
`HONOWARDEN_REFRESH_TOKEN_RETENTION_ENABLED` and targeted only rows expired for
at least 30 days in bounded batches. That note did not rewrite the historical
2026-07-09 deployment, smoke, or cron-run records below and is not a claim about
the current configuration.

## Deployment Readback

Source commit deployed: `b1270b557c604a868091ec3b4252c9b7566c958b`.

Schedule observed from the then-reviewed `wrangler.jsonc` and deployment
readback:

```text
0 * * * *
```

Staging:

- D1 database: `honowarden-staging`
- schema versions after migration: `0001`, `0002`, `0003`, `0004`, `0005`
- Worker deployment ID: `7c18224d-feea-4e4e-9a53-aedd996273d5`
- Worker version ID: `35702116-2232-4236-9d81-dcc648ed2374`
- traffic: `100%`
- deploy output included `schedule: 0 * * * *`

Production:

- D1 database: `honowarden`
- schema versions after migration: `0001`, `0002`, `0003`, `0004`, `0005`
- Worker deployment ID: `b7e1fec2-75ef-4728-8126-0346977589a7`
- Worker version ID: `96a2c5d1-7fce-42cf-8ab1-5709b69fe83c`
- traffic: `100%`
- deploy output included `schedule: 0 * * * *`

## Health Smoke

Staging smoke after deploy:

- `/health`: `ok`, environment `staging`
- `/healthz`: `ok`, environment `staging`
- `/health/db`: `ok`, schema version `0005`
- `/api/config`: returned alpha config with registration disabled
- synthetic prelogin for an unallowlisted address: HTTP `403`

Production smoke after deploy:

- `/health`: `ok`, environment `production`
- `/healthz`: `ok`, environment `production`
- `/health/db`: `ok`, schema version `0005`
- `/api/config`: returned alpha config with registration disabled
- synthetic prelogin for an unallowlisted address: HTTP `403`

## Cron Execution Evidence

Synthetic cleanup rows were inserted at `2026-07-09T15:26:22Z` to prove that
the scheduled handler executed in the observed environments. These rows used
only `hon-51-cron-smoke` identifiers and did not reference real users or vault
data.

Before the next hourly cron:

| Environment | `auth_attempts` rows | `auth_failure_buckets` rows |
| ----------- | -------------------- | --------------------------- |
| staging     | `1`                  | `1`                         |
| production  | `1`                  | `1`                         |

Wrangler tail captured scheduled events for the next hourly cron:

| Environment | Event timestamp            | Scheduled time             | Version ID                             | Outcome |
| ----------- | -------------------------- | -------------------------- | -------------------------------------- | ------- |
| staging     | `2026-07-09T16:00:08.894Z` | `2026-07-09T16:00:08.000Z` | `35702116-2232-4236-9d81-dcc648ed2374` | `ok`    |
| production  | `2026-07-09T16:00:08.895Z` | `2026-07-09T16:00:08.000Z` | `96a2c5d1-7fce-42cf-8ab1-5709b69fe83c` | `ok`    |

After the hourly cron:

| Environment | `auth_attempts` rows | `auth_failure_buckets` rows |
| ----------- | -------------------- | --------------------------- |
| staging     | `0`                  | `0`                         |
| production  | `0`                  | `0`                         |

The scheduled handler executed successfully in both observed environments and
deleted the synthetic cleanup rows.

## Historical Failure Signals And Recovery Note

The 2026-07 packet identified these failure signals:

- `/health/db` stopped reporting `ok`
- synthetic cleanup rows remained after the next scheduled window
- Cloudflare Cron Events or Worker logs showed scheduled invocation failures

The old packet proposed keeping additive migrations `0004` and `0005`, changing
the cron trigger through a hotfix when necessary, and considering Worker
versions `bf0333dc-9efa-4001-aa31-20b3e10731c9` (staging) and
`72577dd9-c859-4673-b653-fbdd796f8f7d` (production) as recovery handles. No
rollback or trigger-disable operation was recorded here.

The copy-pastable rollback commands and prospective "immediate recovery"
procedure were deliberately removed. Those version IDs are historical
identifiers, not verified current targets. A current incident must stop further
writes, preserve fresh deployment/settings/trigger readback, and enter through
the future remote-write protocol admission boundary in the deployment-authority
runbook; historical approval must not be reused.
