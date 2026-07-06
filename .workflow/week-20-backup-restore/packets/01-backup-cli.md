# Packet 01: Backup CLI

Objective: add operator backup/restore command planning.

Ownership:

- `scripts/honowarden-backup.mjs`
- `package.json`
- `test/ops/backup-cli.test.ts`

Expected output:

- `pnpm backup:export` and `pnpm backup:restore` exist.
- Export dry-run writes a manifest and prints Wrangler command plans.
- Restore dry-run reads a manifest and prints D1/R2 restore plans.
- R2 object backup is driven by an explicit object key list.

Verification:

- `pnpm test -- test/ops/backup-cli.test.ts`
