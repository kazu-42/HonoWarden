# Backup And Restore Runbook

HonoWarden stores structured account and vault-sync state in D1. R2 is reserved
for larger object payloads. Backup and restore operations are intentionally
operator-driven in the alpha scope; there is no authenticated public backup API.

The wrapper script plans and optionally executes Wrangler commands:

```sh
pnpm backup:export --out backups/example --database honowarden --bucket honowarden-vault-objects --mode local
pnpm backup:restore --from backups/example --database honowarden-restore --bucket honowarden-restore-vault-objects --mode local
```

Both commands are dry-run by default. They print the commands that would run and
write or read `backup-manifest.json`. Add `--execute` only when the target is
correct and the operation is safe.

## What The Backup Contains

The backup directory contains:

- `backup-manifest.json`: schema version, source resource names, object list
  source, object list, planned commands, and file checksums after an executed
  export
- `d1.sql`: D1 SQL export
- `r2/`: object files named by base64url-encoded object keys

The backup still contains sensitive encrypted application data and operational
metadata. Store it as sensitive data even though HonoWarden never decrypts vault
payloads server-side.

## R2 Object Discovery

Wrangler's `r2 object get` and `put` commands operate on a single object path.
Wrangler 4.107 does not expose an `r2 object list` command, so the wrapper has
two object discovery modes:

1. `--r2-objects <file>` for local/offline drills with a reviewed object key
   list.
2. `--r2-list` for remote object discovery through Cloudflare R2's
   S3-compatible `ListObjectsV2` API.

Use an explicit object key list when R2 objects need to be captured in local
mode:

```text
attachments/object-one
attachments/object-two
```

Then run:

```sh
pnpm backup:export -- \
  --out backups/20260706T000000Z \
  --database honowarden \
  --bucket honowarden-vault-objects \
  --mode local \
  --r2-objects object-keys.txt
```

Blank lines and `#` comments are ignored. Duplicate keys are de-duplicated while
preserving first-seen order.

Use automatic listing for remote backups:

```sh
R2_ACCESS_KEY_ID=... \
R2_SECRET_ACCESS_KEY=... \
CLOUDFLARE_ACCOUNT_ID=... \
pnpm backup:export -- \
  --out backups/20260706T000000Z \
  --database honowarden \
  --bucket honowarden-vault-objects \
  --mode remote \
  --env production \
  --r2-list \
  --r2-prefix attachments/
```

`--r2-list` is remote-only. It requires R2 S3 API credentials through
`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`; `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` are accepted aliases for S3-compatible tooling. The
endpoint defaults to
`https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`, or can be
overridden with `--r2-list-endpoint` for controlled drills.

The default list page size is 1000. Use `--r2-list-page-size <1-1000>` when a
smaller page size is needed for pagination testing. During dry-run, the script
performs only the listing read so it can plan exact `r2 object get` commands; it
does not download object bodies unless `--execute` is present.

## Local Backup

Plan a local backup:

```sh
pnpm backup:export -- \
  --out backups/local-$(date -u +%Y%m%dT%H%M%SZ) \
  --database honowarden \
  --bucket honowarden-vault-objects \
  --mode local \
  --r2-objects object-keys.txt
```

Execute it:

```sh
pnpm backup:export -- \
  --out backups/local-$(date -u +%Y%m%dT%H%M%SZ) \
  --database honowarden \
  --bucket honowarden-vault-objects \
  --mode local \
  --r2-objects object-keys.txt \
  --execute
```

After an executed export, the script rewrites the manifest with SHA-256 hashes
for `d1.sql` and each listed R2 object file. Restore execution requires these
hashes.

Wrangler 4.107 accepts `--persist-to` for `d1 execute` and `r2 object`, but not
for `d1 export`. The wrapper therefore does not pass `--persist-to` to D1 export.
If a future Wrangler version adds support, update tests before changing this.

## Remote Backup

Remote backup uses `--mode remote` and should be run only after confirming the
active Cloudflare account and Wrangler environment:

```sh
pnpm backup:export -- \
  --out backups/prod-$(date -u +%Y%m%dT%H%M%SZ) \
  --database honowarden \
  --bucket honowarden-vault-objects \
  --mode remote \
  --env production \
  --r2-list
```

Execute only after reviewing the printed commands:

```sh
pnpm backup:export -- \
  --out backups/prod-$(date -u +%Y%m%dT%H%M%SZ) \
  --database honowarden \
  --bucket honowarden-vault-objects \
  --mode remote \
  --env production \
  --r2-list \
  --execute
```

`--persist-to` is local-only and is rejected with `--mode remote`.

## Restore Drill

Restore should target fresh resources. The script cannot prove resource
emptiness through Wrangler's object-level commands, so restore execution requires
an explicit operator assertion:

```sh
pnpm backup:restore -- \
  --from backups/prod-20260706T000000Z \
  --database honowarden-restore \
  --bucket honowarden-restore-vault-objects \
  --mode local
```

Execute after creating fresh target resources and reviewing the plan:

```sh
pnpm backup:restore -- \
  --from backups/prod-20260706T000000Z \
  --database honowarden-restore \
  --bucket honowarden-restore-vault-objects \
  --mode local \
  --execute \
  --confirm-fresh-target
```

Before executing any Wrangler command, restore checks:

- manifest schema version and required fields
- manifest file paths are relative and cannot escape the backup directory
- R2 object files stay under `r2/`
- R2 object file names match the deterministic base64url encoding of their
  object keys
- every required file exists
- every required SHA-256 hash exists and matches the local file

## Recovery And Rollback

The safest rollback is to discard the restore target and recreate it from the
same backup. Do not restore over the source resource during the alpha phase.

If D1 restore succeeds and an R2 object upload fails:

1. Keep the failed target isolated.
2. Re-run the same restore command only if the target is disposable and the
   missing object uploads are idempotent for the drill.
3. Prefer deleting and recreating the target resources before re-running a
   production-like restore drill.
4. Record the failure, command output, manifest path, source commit, and target
   resource names in the project update.

## Verification Checklist

For each drill, record:

- source commit SHA
- Wrangler version
- export command and restore command
- backup directory and manifest path
- source D1 database and R2 bucket names
- fresh restore D1 database and R2 bucket names
- `GET /health/db` result against the restored Worker or local environment
- official-client or fixture sync result after restore
- any failed command and recovery action
