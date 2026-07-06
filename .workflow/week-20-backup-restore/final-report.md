# Final Report: Week 20 Backup Restore

## Outcome

Week 20 backup/restore tooling is implemented locally. The slice adds an operator CLI for D1/R2 export and restore planning, dry-run defaults, manifest safety checks, restore execution preflight, and an operations runbook.

## Accepted Results

- Export and restore commands are operator tools, not public HTTP API routes.
- Dry-run is the default behavior for both export and restore.
- D1 backup uses Wrangler `d1 export`; D1 restore uses Wrangler `d1 execute --file`.
- R2 backup/restore uses explicit object key lists with Wrangler `r2 object get` and `put`.
- Executed export rewrites the manifest with SHA-256 file hashes.
- Restore execution requires `--confirm-fresh-target` and verifies file hashes before running Wrangler commands.
- Manifest paths are relative, cannot escape the backup directory, and R2 object files must stay under `r2/`.
- Backup and restore operation details are documented in `docs/operations/backup-restore.md`.

## Rejected Results

- Public backup/export route in the Worker.
- Restore execution without explicit fresh-target acknowledgement.
- Trusting manifest paths without traversal checks.
- Passing `--persist-to` to Wrangler subcommands that do not support it.
- Claiming live remote backup/restore evidence without running a live drill.

## Conflicts Resolved

- Kept `--persist-to` local-only and command-specific because the installed Wrangler CLI supports it for `d1 execute` and `r2 object`, but not `d1 export`.
- Required an explicit R2 object list because the used Wrangler object commands operate on individual object keys.
- Chose checksum preflight for restore `--execute`; dry-run restore can still plan from a manifest without touching files.

## Verification Evidence

- `pnpm test -- test/ops/backup-cli.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan: no content hits
- repository path brand scan: no path hits
- workflow verifier: passed

## Remaining Risks

- No live remote backup or restore drill has been run.
- R2 object lists can be incomplete if the operator does not maintain a complete object inventory.
- A restore can still partially apply if D1 succeeds and a later R2 upload fails; safest recovery is deleting the disposable target and recreating it from the same backup.
- No scheduled backup automation exists yet.
- No live client post-restore sync evidence is recorded.

## Reusable Follow-up

- Reuse the manifest checksum pattern for future scheduled backups.
- Reuse the restore drill checklist in release evidence.
