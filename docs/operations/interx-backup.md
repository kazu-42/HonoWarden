# InterX backup and recovery

## Target and credentials

The dedicated `InterX Backup` workflow exports D1 `honowarden-interx` and every
object in R2 `honowarden-interx-vault-objects`. It verifies the pinned InterX
account hash before access. It never uses the global API key. Existing gHive
backup workflows and credentials are independent.

The operator used the explicitly authorized global key to create one expiring
user API token. A live D1 Read export returned HTTP 401; D1 Write succeeded.
Consequently, this token has **account-scoped D1 Write**, not database-only or
read-only D1 access. Its R2 permission is Bucket Item Read on the single InterX
vault bucket. S3 access uses the token ID and SHA-256 of its value, as documented
by [Cloudflare](https://developers.cloudflare.com/r2/api/tokens/).

The token expires on **2027-01-19 00:00 UTC**. Rotate it before expiry, update the
three corresponding GitHub secrets, then dispatch and verify a backup before
revoking the previous token. Do not rotate the archive key without preserving
the old key for every retained archive.

Repository secrets:

- `HONOWARDEN_INTERX_ACCOUNT_ID`
- `HONOWARDEN_INTERX_BACKUP_TOKEN`
- `HONOWARDEN_INTERX_R2_ACCESS_KEY_ID`
- `HONOWARDEN_INTERX_R2_SECRET_ACCESS_KEY`
- `HONOWARDEN_INTERX_BACKUP_ARCHIVE_KEY`

The archive key is 32 random bytes encoded as canonical unpadded base64url.
Preserve a separate secured recovery copy outside GitHub and this workstation;
GitHub secrets cannot be read back. Loss of this key makes archives unrecoverable.
Do not put credentials, SQL, object keys, or archives in public evidence.

## Schedule, storage and verification

The workflow specifies 18:47 UTC / 03:47 JST daily and manual dispatch. Scheduled
execution starts only after the workflow reaches the default branch. GitHub may
delay scheduled runs. Inspect the actual latest successful run and artifact;
configuration alone does not prove a working schedule.

Each run downloads objects through signed S3 GET (`--r2-list --r2-s3`) so that
bucket read credentials suffice. A failed or oversized download fails the run.
The current per-object limit is 1 GiB. D1 and R2 are not an atomic snapshot:
concurrent writes or deletions can cause inconsistent recovery. Treat this as
an additional recovery copy, not application-level recovery acceptance. For a
release/recovery checkpoint, quiesce writers through the established lifecycle
procedure and validate the resulting data and generation before admitting writes.

Only an AES-256-GCM encrypted archive and sanitized evidence are uploaded, for
14 days. The workflow decrypts and compares bytes before upload and removes
plaintext in an always-run cleanup step. GitHub Actions execution/artifact storage
is billed under the repository owner's applicable GitHub plan; Cloudflare D1/R2
export and read usage belongs to InterX. This is not immutable off-site retention.

Watch failed or missing daily runs, check artifact availability, and repeat a
restore drill after schema or storage lifecycle changes. Recovery-point exposure
is at least the time since the latest successful consistent backup; no measured
recovery-time SLA has been established.

## Restore to an isolated target

1. Download the selected run's artifact to a private directory (0700). Record its
   run URL, source commit and archive hash. Load the preserved archive key into
   `HONOWARDEN_BACKUP_ARCHIVE_KEY` without logging it.
2. Authenticate and decrypt to a new file:
   `node scripts/honowarden-backup-archive.mjs decrypt interx-backup.tar.gz.enc recovered.tar.gz`.
   Wrong keys or changed bytes fail before publishing a completed plaintext file.
3. Inspect archive paths/types before extracting into an empty private directory.
   The workflow archive contains `interx-snapshot/`. Never extract an untrusted
   archive over a checkout or operator configuration.
4. Configure fresh isolated D1/R2 bindings. Use the existing restore CLI with
   `--from <snapshot> --mode local --config <isolated-config> --persist-to <isolated-state>
--execute --confirm-fresh-target`. Consult `--help` for the explicit database
   and bucket target arguments. Remote restore requires separate approved write
   credentials; the scheduled R2 read credential cannot restore objects.
5. Verify schema, SQLite integrity, foreign keys, manifest hashes and every R2
   object. Then verify account login, vault decryption, attachments and sharing
   through the recovered application before considering a production cutover.
   Never automatically overwrite the live database as rollback.

The 2026-10-21 local drill restored the live schema (version 0033), with integrity
`ok`, zero foreign-key violations and one synthetic R2 object whose hash matched.
Authenticated archive decryption and byte comparison passed. There were zero
users: account login and application decryption after recovery remain unproven.
