# Packet 03: Cron Readback

## Scope

Use synthetic transient-auth rows to prove the live scheduled cleanup handler
executed.

## Evidence Before Cron

Inserted at `2026-07-09T15:26:22Z`:

| Environment | `auth_attempts` rows | `auth_failure_buckets` rows |
| ----------- | -------------------- | --------------------------- |
| staging     | `1`                  | `1`                         |
| production  | `1`                  | `1`                         |

## Evidence After Cron

Wrangler tail captured scheduled events at `2026-07-09T16:00:08Z` with
`outcome: ok` in staging and production.

After the hourly scheduled execution:

| Environment | `auth_attempts` rows | `auth_failure_buckets` rows |
| ----------- | -------------------- | --------------------------- |
| staging     | `0`                  | `0`                         |
| production  | `0`                  | `0`                         |

HON-51 can move to Done after docs, CI, PR merge, and Linear readback complete.
