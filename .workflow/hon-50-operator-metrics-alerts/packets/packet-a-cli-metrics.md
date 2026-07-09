# Packet A: CLI Metrics

Objective: extend `scripts/honowarden-abuse-report.mjs` with cleanup candidate
metric queries.

Completed:

- Added retention metadata to the JSON packet.
- Added cleanup candidate queries for `auth_attempts`,
  `auth_failure_buckets`, `totp_challenges`, `audit_events`, and
  `request_quota_buckets`.
- Kept the command dry-run-first unless `--execute` is supplied.

Verification:

- `pnpm test -- test/ops/abuse-report-cli.test.ts`
- `node scripts/honowarden-abuse-report.mjs --database honowarden --mode local`
