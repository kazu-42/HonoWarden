# Week 26 Backup Restore Drill Evidence Orchestration

## Goal

Resolve the backup/restore drill evidence release blocker using a local
synthetic drill.

## Sequence

1. Apply local D1 migrations to the source local database.
2. Execute `pnpm backup:export` into ignored `test/.tmp` storage.
3. Execute `pnpm backup:restore` into a fresh local persistence target.
4. Verify restored table names through Wrangler D1 execute.
5. Record evidence under `docs/release/backup-restore-drill-evidence.md`.
6. Harden release gate preflight so placeholder evidence does not pass.
7. Run local gates, brand scans, workflow verifier, push, and wait for CI.
8. Record CI evidence.

## External Writes

No remote external writes are allowed. The only state changes are local ignored
Wrangler state and ignored `test/.tmp` drill artifacts.

## Verification Policy

Fail the workflow if the drill commands fail, if the evidence document omits
source/target/command/checksum/verification details, if `pnpm release:gate`
still reports backup drill evidence as blocking, or if CI fails.
