# Packet: Backup Audit Packet

## Objective

Add secret-safe operator audit packets to backup CLI stdout for export and
restore planning/execution.

## Scope

- `scripts/honowarden-backup.mjs`
- `test/ops/backup-cli.test.ts`
- backup/audit docs

## Verification

CLI tests assert `backup.export` and `backup.restore` audit packets contain
action name, outcome, manifest SHA-256 id, and result status only.
