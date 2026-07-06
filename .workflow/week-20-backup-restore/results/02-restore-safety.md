# Result 02: Restore Safety

Accepted:

- Added manifest path validation for D1 and R2 files.
- Added command-specific Wrangler flag generation.
- Added local-only `--persist-to` behavior.
- Added executed-export SHA-256 hash recording.
- Added restore `--execute` fresh-target confirmation.
- Added restore `--execute` checksum preflight before running Wrangler commands.

Rejected:

- Trusting manifest paths from `backup-manifest.json`.
- Restore execution without an operator assertion that target resources are fresh.

Verification:

- `pnpm test -- test/ops/backup-cli.test.ts`
- `pnpm check`
- `pnpm lint`
