# Result 01: Backup CLI

Accepted:

- Added `scripts/honowarden-backup.mjs`.
- Added `pnpm backup:export` and `pnpm backup:restore`.
- Export dry-run writes `backup-manifest.json` and prints D1/R2 command plans.
- Restore dry-run reads `backup-manifest.json` and prints D1/R2 command plans.
- R2 objects are captured from an explicit key-list file.

Rejected:

- Adding a Worker HTTP route for backup export in this slice.

Verification:

- `pnpm test -- test/ops/backup-cli.test.ts`
