# Packet B: Alerts

Objective: add operator-facing alert classifications and first-response
guidance.

Completed:

- Added warning and critical thresholds for active blocked request quota
  buckets.
- Added thresholds for active locked auth-failure buckets.
- Added cleanup backlog and scheduled cleanup failure signals.
- Kept alert first-response guidance focused on aggregate counts, hashed bucket
  tags, timestamps, deployment readback, and schema readback.

Verification:

- `pnpm test -- test/ops/abuse-report-cli.test.ts`
