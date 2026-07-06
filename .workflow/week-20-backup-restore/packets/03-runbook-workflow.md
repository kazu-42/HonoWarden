# Packet 03: Runbook And Workflow

Objective: record the Week 20 operational contract and verification evidence.

Ownership:

- `docs/operations/backup-restore.md`
- `docs/current-state.md`
- `README.md`
- `.workflow/week-20-backup-restore/*`

Expected output:

- Backup/restore runbook documents local and remote modes.
- Current state records Week 20 implemented and missing work.
- Workflow has packet, result, final report, and verification evidence.
- Full local gate and CI evidence are recorded.

Verification:

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
