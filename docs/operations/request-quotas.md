# Global Request Quotas

Status: implemented, disabled by default.

HonoWarden can enforce a coarse global request quota before route handling by
setting:

```sh
HONOWARDEN_GLOBAL_REQUEST_QUOTA=true
```

The default Wrangler configuration keeps this flag `false` for development,
staging, and production. Operators should enable it only after `0008` has been
applied to the target D1 database and normal traffic baselines are understood.

## Policy

The quota uses one-minute windows:

| Scope         | Limit per hashed client-address bucket | Retry window |
| ------------- | -------------------------------------- | ------------ |
| anonymous     | 120 requests                           | 60 seconds   |
| authenticated | 600 requests                           | 60 seconds   |

The scope is selected from the request headers before route authentication:

- `Authorization: Bearer ...` uses the `authenticated` scope.
- All other HTTP requests use the `anonymous` scope.

The bucket value is a SHA-256 base64url tag derived from the request client
address selected by the existing login-defense rules. HonoWarden does not store
plaintext IP addresses in `request_quota_buckets`.

`OPTIONS`, `/health`, and `/healthz` bypass the quota so browser preflight and
infrastructure probes do not look like application abuse.

## Failure Behavior

Quota checks fail loudly:

- over-limit buckets return `429 rate_limited` and `Retry-After: 60`
- D1 failures return `503 database_unavailable`
- D1 failures are not converted into 429s

This keeps operational outages distinct from abuse throttling.

## Operator Report

Generate the alpha abuse report and alert plan:

```sh
pnpm abuse:report -- --database honowarden --mode local
```

For a remote readback, review the target database name first, then run:

```sh
pnpm abuse:report -- --database honowarden --mode remote --execute
```

The report queries:

- `request_quota_buckets` grouped by scope
- top request quota buckets by request count
- `auth_failure_buckets` grouped by existing login-defense bucket scope
- top auth failure buckets by failed count
- cleanup candidate counts for stale `auth_attempts`
- cleanup candidate counts for stale, unlocked `auth_failure_buckets`
- cleanup candidate counts for expired or consumed `totp_challenges`
- cleanup candidate counts for expired `audit_events`
- cleanup candidate counts for expired, unblocked `request_quota_buckets`

The report also emits an operator alert packet with warning and critical
thresholds for:

- active blocked global request quota buckets
- active locked auth-failure buckets
- cleanup candidate row growth
- repeated Cloudflare Cron Event failure for the hourly cleanup handler

Treat the packet as an incident triage input, not an automatic page. The first
response is to compare scope, current deployment version, schema version, and
hourly Cron Event outcome before changing quota policy or cleanup limits.

The report intentionally shows hashed bucket prefixes only. It must not be used
to publish plaintext IPs, bearer tokens, email addresses, vault payloads, or
private operator identities.

External alert notification sinks and dashboards are not configured by this
script. Operators should paste only aggregate counts, hashed bucket tags,
timestamps, alert IDs, and runbook conclusions into evidence records.

## Cleanup

When global request quotas are enabled, the hourly scheduled maintenance handler
deletes expired, unblocked `request_quota_buckets` rows in bounded slices of 100. The cleanup path is idempotent and separate from auth failure bucket
cleanup.
