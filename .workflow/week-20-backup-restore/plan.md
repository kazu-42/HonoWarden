# Week 20 Backup Restore

## Goal

Provide an operator-safe D1/R2 backup and restore workflow for alpha readiness.
The slice should make backup drills repeatable without adding a public backup
API surface.

## Success Criteria

- `pnpm backup:export` plans D1 export and optional R2 object downloads.
- `pnpm backup:restore` plans D1 import and optional R2 object uploads into fresh targets.
- Both commands are dry-run by default and require `--execute` for side effects.
- Executed exports record SHA-256 file hashes in the manifest.
- Executed restores fail closed unless `--confirm-fresh-target` is present and manifest file hashes match.
- Manifest paths cannot escape the backup directory.
- The runbook documents local/remote mode, explicit R2 object lists, fresh target expectations, and partial-restore recovery.
- Local gates, repository brand scan, workflow verifier, and CI pass.

## Current Context

Week 19 added recent-auth claims for sensitive HTTP routes. Week 20 is operational rather than a route feature: Cloudflare D1/R2 backup and restore must be possible before alpha, but exposing backup over the public API would expand attack surface.

## Constraints

- Keep the server API-only; no public export endpoint in this slice.
- Default to dry-run for potentially destructive operations.
- Do not store real secrets or real vault data in fixtures.
- Do not introduce direct external provider brand strings in tracked files.
- Treat backups as sensitive even though payloads remain encrypted by clients.

## Risks

- Restore into a non-fresh resource can overwrite or merge state unexpectedly.
- R2 object listing is not provided by the used Wrangler object commands, so incomplete object lists can produce incomplete backups.
- Sequential Wrangler commands can leave a partially restored target if a later R2 upload fails.
- Tampered manifests can redirect restore inputs unless paths and hashes are verified.

## Approval Required

No approval is required for local code, tests, docs, git push, and CI. Live Cloudflare resource creation, remote backup execution, remote restore execution, production secrets, and live client attempts require a separate gate.

## Work Packets

- `01-backup-cli`: Add backup/restore CLI planning and dry-run behavior.
- `02-restore-safety`: Add manifest path safety, checksum preflight, and fresh-target guard.
- `03-runbook-workflow`: Document the runbook, current-state increment, workflow artifacts, and verification evidence.

## Integration Policy

Do not couple backup/restore to request handlers. Keep this as an operator tool until auth, audit, and live drill evidence justify a server-side API.

## Verification

- `pnpm test -- test/ops/backup-cli.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI

## Reusable Artifacts

The manifest safety helpers and runbook checklist should be reusable for future scheduled backups, restore drills, and release evidence.
