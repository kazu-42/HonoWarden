# Packet C: Docs

Objective: align operator documentation with the new abuse report alert packet.

Completed:

- Updated request quota operations docs with query IDs, alert signals, and
  external sink boundaries.
- Added retention cleanup metrics and alert guidance.
- Updated current-state docs to remove resolved metrics gaps.
- Updated security known limitations to distinguish the implemented packet from
  missing external notification/dashboard wiring.

Verification:

- `pnpm test -- test/ops/retention-cron-evidence.test.ts test/security-docs.test.ts`
