# Final Report: HON-46 global request quotas

HON-46 adds opt-in global request quota support for the HonoWarden Worker.

The implementation stores request counters in `request_quota_buckets` using
hashed bucket keys and scope labels. It never stores plaintext IP addresses.
Quota exceedance returns `429 rate_limited` with `Retry-After`; quota persistence
failures return `503 database_unavailable`.

The feature is disabled by default across development, staging, and production.
Operators can enable it after applying migration `0008` and reviewing the
traffic baseline.

The operator-facing report remains dry-run-first and secret-safe. External
dashboard and alert integration remains HON-50.
