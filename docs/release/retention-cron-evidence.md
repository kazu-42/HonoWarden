# Retention Cron Evidence

Status: passed.

Current Readback: 2026-07-09T16:03:22Z.

This file records the live Cloudflare closeout for the transient auth retention
cleanup Cron Trigger. It intentionally records only deployment IDs, Worker
version IDs, schema versions, synthetic cleanup row counts, and redacted health
smoke results.

Do not record account emails, API keys, token values, private mailbox
destinations, real user data, vault contents, or Cloudflare secret values here.

## Scope

The live cleanup path covers only transient authentication tables:

- `auth_attempts`
- `auth_failure_buckets`
- `totp_challenges`

It does not delete users, devices, refresh tokens, folders, ciphers, audit log
lines, backup manifests, R2 objects, or inquiry inbox data.

## Deployment Readback

Source commit deployed: `b1270b557c604a868091ec3b4252c9b7566c958b`.

Schedule configured by `wrangler.jsonc` and deployment readback:

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

Synthetic cleanup rows were inserted at `2026-07-09T15:26:22Z` to prove the
scheduled handler executes in live environments. These rows use only
`hon-51-cron-smoke` identifiers and do not reference real users or vault data.

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

The scheduled handler executed successfully in both live environments and
deleted the synthetic cleanup rows.

## Failure And Rollback

Failure signal:

- `/health/db` stops reporting `ok`
- synthetic cleanup rows remain after the next scheduled window
- Cloudflare Cron Events or Worker logs show scheduled invocation failures

Immediate recovery:

1. Keep D1 migrations `0004` and `0005`; they are additive columns.
2. If the scheduled handler causes failures, disable the trigger with a hotfix
   deploy that removes the target environment's `triggers.crons` entry.
3. If the runtime itself must roll back, rollback to the previous Worker
   version and then separately verify the trigger state:

```sh
pnpm wrangler rollback bf0333dc-9efa-4001-aa31-20b3e10731c9 --env staging --name honowarden-staging --yes
pnpm wrangler rollback 72577dd9-c859-4673-b653-fbdd796f8f7d --env production --name honowarden --yes
```

4. Re-run `/health`, `/healthz`, `/health/db`, `/api/config`, and synthetic
   prelogin smoke after any rollback or disable deploy.
