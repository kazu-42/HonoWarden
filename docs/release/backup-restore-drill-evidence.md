# Backup Restore Drill Evidence

Target: `v0.1.0-alpha`.

Status: passed

Mode: local synthetic drill

Recorded at: 2026-07-06T14:39:39Z.

This evidence records a local synthetic backup and fresh-target restore drill.
It proves the repository backup wrapper can export the local D1 database, write
a checksum-bearing manifest, restore into a separate local persistence target,
and verify the restored schema. It does not prove remote Cloudflare backup,
remote R2 object restoration, or production readiness.

## Source

- Source commit: `5ee4e10319189b1f3e7a1f8f354e16bcebc1ff50`
- Wrangler version: `4.107.0`
- Source D1 database: `honowarden`
- Source R2 bucket argument: `honowarden-vault-objects`
- R2 object list: empty
- Backup directory: `test/.tmp/release-backup-drill-20260706T143928Z/backup`
- Manifest path:
  `test/.tmp/release-backup-drill-20260706T143928Z/backup/backup-manifest.json`

## Commands

The source local D1 database was first migrated with:

```sh
printf 'y\n' | pnpm wrangler d1 migrations apply honowarden --local
```

Export command:

```sh
pnpm backup:export --out test/.tmp/release-backup-drill-20260706T143928Z/backup --database honowarden --bucket honowarden-vault-objects --mode local --execute
```

Restore command:

```sh
pnpm backup:restore --from test/.tmp/release-backup-drill-20260706T143928Z/backup --database honowarden --bucket honowarden-restore-vault-objects --mode local --persist-to test/.tmp/release-backup-drill-20260706T143928Z/restore-state --execute --confirm-fresh-target
```

Restore verification command:

```sh
pnpm wrangler d1 execute honowarden --local --persist-to test/.tmp/release-backup-drill-20260706T143928Z/restore-state --command "select name from sqlite_master where type = 'table' order by name;"
```

## Manifest Evidence

- Manifest mode: `local`
- Manifest database: `honowarden`
- Manifest bucket: `honowarden-vault-objects`
- Manifest R2 objects: `0`
- D1 SQL size: `5444` bytes
- D1 SQL SHA-256:
  `562fc6a06acaa6056c727d162ac74768b16fa833f05db3a04769061cde966eac`

## Verification Result

Verification result: restored table list matched the required alpha schema
tables.

The restored local persistence target reported these tables:

- `_cf_METADATA`
- `auth_attempts`
- `auth_failure_buckets`
- `ciphers`
- `d1_migrations`
- `devices`
- `folders`
- `refresh_tokens`
- `schema_migrations`
- `sqlite_sequence`
- `totp_challenges`
- `user_totp`
- `users`

## Limitations

- This is not remote Cloudflare evidence.
- This does not prove remote R2 object restore behavior because no R2 objects
  were present in the local drill.
- This does not replace staging deploy smoke evidence.
- This does not contain real vault data or real secrets.
