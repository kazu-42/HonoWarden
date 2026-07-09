# Packet 01: Scheduled Job

## Objective

Add a scheduled remote backup workflow and a reviewable schedule packet.

## Scope

- `.github/workflows/remote-backup.yml`
- `scripts/honowarden-scheduled-backup-packet.mjs`
- `package.json`
- `test/ops/scheduled-backup-packet.test.ts`
- `test/ops/remote-backup-workflow.test.ts`

## Acceptance

- Workflow has manual and cron triggers.
- Workflow requires secret-backed env and fails loudly when missing.
- Backup artifact is encrypted before upload.
- Artifact retention is short and explicit.
- Workflow does not run restore or destructive git commands.
