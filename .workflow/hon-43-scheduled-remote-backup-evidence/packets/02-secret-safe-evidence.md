# Packet 02: Secret-Safe Evidence

## Objective

Generate public backup evidence from an executed checksum-bearing manifest.

## Scope

- `scripts/honowarden-backup.mjs`
- `test/ops/backup-cli.test.ts`

## Acceptance

- `backup:evidence` verifies checksums before emitting evidence.
- Evidence includes manifest id, D1 checksum and size, R2 object count, R2
  digest id, and total R2 byte size.
- Evidence omits database names, bucket names, object keys, object bodies, SQL
  contents, and secret values.
- Backup CLI accepts package-manager `--` separators used by docs and workflows.
