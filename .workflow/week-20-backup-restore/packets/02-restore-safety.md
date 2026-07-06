# Packet 02: Restore Safety

Objective: make restore execution fail closed before side effects.

Ownership:

- `scripts/honowarden-backup.mjs`
- `test/ops/backup-cli.test.ts`

Expected output:

- Manifest file paths cannot be absolute or contain `..`.
- R2 manifest file paths must stay under `r2/`.
- `--persist-to` is local-only and only passed to commands that support it.
- Restore `--execute` requires `--confirm-fresh-target`.
- Restore `--execute` verifies SHA-256 checksums before running Wrangler commands.

Verification:

- `pnpm test -- test/ops/backup-cli.test.ts`
- `pnpm check`
- `pnpm lint`
