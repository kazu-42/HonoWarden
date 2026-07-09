# Result 03: Cron Readback

## Outcome

Cron deletion readback passed in staging and production.

## Evidence Before Cron

- Synthetic rows inserted at `2026-07-09T15:26:22Z`
- staging `auth_attempts`: `1`
- staging `auth_failure_buckets`: `1`
- production `auth_attempts`: `1`
- production `auth_failure_buckets`: `1`

## Wrangler Tail Evidence

- staging scheduled event: `2026-07-09T16:00:08.894Z`, outcome `ok`, version
  `35702116-2232-4236-9d81-dcc648ed2374`
- production scheduled event: `2026-07-09T16:00:08.895Z`, outcome `ok`, version
  `96a2c5d1-7fce-42cf-8ab1-5709b69fe83c`

## Readback After Cron

- staging `auth_attempts`: `0`
- staging `auth_failure_buckets`: `0`
- production `auth_attempts`: `0`
- production `auth_failure_buckets`: `0`
