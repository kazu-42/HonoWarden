# Backup And Restore Runbook

HonoWarden stores structured account and vault-sync state in D1. R2 is reserved
for larger object payloads, including cipher attachment bodies stored under
opaque `attachments/<uuid>` keys. Backup and restore operations are
intentionally operator-driven in the alpha scope.

HonoWarden also exposes a separate user-initiated export API:
`POST /api/accounts/export`. That route is not a disaster-recovery backup. It
returns only the authenticated user's account metadata, folders, ciphers, and
cipher attachment metadata after recent password authentication. It does not
export D1 SQL, refresh-token tables, password hashes, raw R2 attachment object
bodies, or internal R2 object keys.

The wrapper script plans and optionally executes Wrangler commands:

```sh
pnpm backup:export --out backups/example --database honowarden --bucket honowarden-vault-objects --mode local
pnpm backup:restore --from backups/example --database honowarden-restore --bucket honowarden-restore-vault-objects --mode local
```

Both commands are dry-run by default. They print the commands that would run and
write or read `backup-manifest.json`. Add `--execute` only when the target is
correct and the operation is safe.

The JSON stdout also contains a secret-safe `audit` packet:

```json
{
  "name": "backup.export",
  "outcome": "success",
  "manifestId": "sha256:<manifest-sha256>",
  "resultStatus": "planned"
}
```

For restore, `name` is `backup.restore`. `resultStatus` is `planned` for dry-run
and `executed` only after `--execute` commands complete. The audit packet does
not include database names, bucket names, object keys, command arguments, or
backup file contents.

Stdout remains one machine-readable JSON document in both planned and executed
mode. Child Wrangler output is routed to stderr so progress banners and command
diagnostics cannot corrupt the final audit JSON. A non-zero child exit still
fails the wrapper loudly and suppresses a false success packet.

## What The Backup Contains

The backup directory contains:

- `backup-manifest.json`: schema version, source resource names, object list
  source, object list, planned commands, optional derived credential-generation
  binding, and file checksums after an executed export
- `d1.sql`: D1 SQL export
- `r2/`: object files named by base64url-encoded object keys

D1 contains attachment metadata in `cipher_attachments`; R2 contains the opaque
attachment bytes. A complete attachment backup must include both the D1 export
and every referenced `attachments/` R2 object.

The backup still contains sensitive encrypted application data and operational
metadata. Store it as sensitive data even though HonoWarden never decrypts vault
payloads server-side.

## User Export API

Use `POST /api/accounts/export` for a user-triggered encrypted vault export.
This route requires the same bearer token validation as `/api/sync` plus the
recent password-auth guard used by sensitive account operations:

- `authMethod` must be `password`
- token issue time must be within five minutes
- refresh-auth, stale password-auth, and legacy claimless tokens receive
  `reauth_required`

The response has `Cache-Control: no-store` and a download-oriented
`Content-Disposition` filename. The JSON object has `object: "backupExport"`
and `schemaVersion: 1`. It contains:

- account metadata needed by the user export
- active folders
- owner-scoped ciphers, including deleted ciphers when the sync read model
  returns them
- cipher attachment metadata with encrypted file name and attachment key fields

The response intentionally excludes:

- master password hashes
- refresh-token rows or token hashes
- TOTP encrypted setup secrets
- internal R2 `object_key` values
- raw R2 object bodies
- rows belonging to another user

Audit logging emits `backup.export` success and database-failure events when
`HONOWARDEN_AUDIT_LOGS=true`. Event context is count-only and does not include
request or response bodies.

The export route participates in the opt-in HON-46 global request quota when
`HONOWARDEN_GLOBAL_REQUEST_QUOTA=true`. Current always-on abuse controls are
bearer authentication, recent password authentication, password-grant login
defense, and Cloudflare platform limits.
Database failures return `503 database_unavailable`; the route performs no
partial writes and can be retried after the underlying D1 issue is resolved.

## R2 Object Discovery

Wrangler's `r2 object get` and `put` commands operate on a single object path.
Wrangler 4.112 does not expose an `r2 object list` command, so the wrapper has
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

Use `--r2-prefix attachments/` when the goal is to capture all vault attachment
objects. The prefix is safe to disclose operationally because the suffix is a
server-generated UUID and does not include user IDs, cipher IDs, emails, or
filenames.

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

Wrangler 4.112 accepts `--persist-to` for `d1 execute` and `r2 object`, but does
not accept it for `d1 export`. The wrapper therefore does not pass
`--persist-to` to D1 export. Instead, local D1 export resolves its state
relative to the selected `--config` file. To export one exact isolated source,
put an owned temporary `wrangler.jsonc` directly under the source root and use
that root's `.wrangler/state` for commands that accept `--persist-to`:

```sh
SOURCE_ROOT=test/.tmp/credential-lifecycle/source
LIFECYCLE_MANIFEST_SHA256=<approved-credential-lifecycle-manifest-sha256>

pnpm backup:export -- \
  --out backups/final-generation \
  --database honowarden \
  --bucket honowarden-vault-objects \
  --mode local \
  --config "$SOURCE_ROOT/wrangler.jsonc" \
  --persist-to "$SOURCE_ROOT/.wrangler/state" \
  --generation-manifest-sha256 "$LIFECYCLE_MANIFEST_SHA256" \
  --r2-objects object-keys.txt \
  --execute
```

`--persist-to` alone does not select the D1 export source. Every local export
that supplies it must also supply `--config`, and the persistence root must
equal `<config-directory>/.wrangler/state`. During execute, both paths must
exist and resolve to their exact supplied paths; config or persistence symlinks
are rejected before output creation or Wrangler spawn. This prevents even an
unbound backup from combining D1 from config-relative or ambient state with R2
from a different persistence root. Omitting both options retains the existing
ambient local behavior.

A generation-bound export adds stricter gates: it is execute-only and requires
local mode, explicit source paths, and an explicit `--r2-objects` inventory.
This prevents a remote or ambient source from being labeled as the approved
generation and prevents an omitted R2 inventory from silently producing a
D1-only recovery artifact. An explicitly empty inventory file is reserved for
a reviewed source known to contain no R2 objects.

For a generation-bound export, the config file and the config, `.wrangler`, and
state directories must also be owned by the current user, with all three
directories at mode `0700`. The persistence root must contain the mode-`0600`
lifecycle ownership marker written by `account:credential-lifecycle`. A
structurally matching but ambient or unmarked operator-created local state
therefore cannot receive a generation binding accidentally.

The ownership marker proves only that the lifecycle prepared the directory; it
does not prove that a credential generation completed. A successful lifecycle
run with retained state writes the current-user-owned, mode-`0600`
`.honowarden-credential-lifecycle-complete.json` attestation only after all
lifecycle checks and owned process cleanup succeed. Its closed schema binds the
approved lifecycle-manifest digest to a domain-separated digest of the retained
durable state tree. A missing attestation, a different lifecycle digest, or any
later durable-state change rejects export before the output claim or a Wrangler
process can start.

The state-tree digest includes relative file names and contents, including
SQLite database and `*.sqlite-wal` files. It excludes only the two lifecycle
marker files and `*.sqlite-shm`: SQLite rewrites that non-durable shared-memory
index during reads even when the database and WAL remain unchanged. Symlinks
and non-regular state entries are rejected rather than omitted. This permits a
repeat export of the same completed state while still rejecting committed or
uncheckpointed WAL changes.

After exporting D1, the wrapper restores that exact `d1.sql` into a private,
temporary local validation database and queries every
`cipher_attachments.object_key`. Every referenced key must be present in the
explicit inventory before any R2 download starts. An empty inventory therefore
succeeds only when the exported D1 attachment-reference set is also empty. The
validation persistence is removed on success or failure and never enters the
backup manifest. The config is passed to every Wrangler command, while the
source `--persist-to` remains limited to supported local D1 and R2 commands.
Unbound backups retain their existing remote and dry-run behavior; unsafe split
local source routing now fails closed.

The bound `--out` path must be missing or an empty directory owned by the
current user at mode `0700`. A newly created output receives that mode; an
existing public or foreign output is rejected instead of being silently
re-permissioned. Reusing a prior output is rejected before Wrangler starts, so
a failed replacement cannot leave an older bound manifest next to partially
overwritten D1 or R2 files. Use a new run-owned output directory for every
generation-bound export.

Before any Wrangler process starts, the wrapper atomically creates
`.generation-bound-export.lock` inside the output directory. It holds that
exclusive claim through D1/R2 hashing and the final manifest write, then removes
it on success or a handled failure. A concurrent export to the same output is
rejected before spawn. If the process is interrupted before cleanup, treat the
remaining claim and any adjacent files as one incomplete artifact and choose a
new output directory; do not remove the claim to reuse the partial output.

`--generation-manifest-sha256` supplies the approved credential-lifecycle
manifest digest; it is not copied into the final generation identity. After all
D1 and R2 export commands succeed, the wrapper hashes the actual D1 SQL and each
sorted R2 key/body checksum into the domain-separated
`honowarden.backup-source.v1` source identity. It then derives the
`honowarden.credential-generation-binding.v1` manifest identity from the
lifecycle digest and source identity:

```json
{
  "schemaVersion": 1,
  "lifecycleManifestSha256": "<approved-lifecycle-manifest-sha256>",
  "sourceStateSha256": "<derived-d1-r2-source-sha256>",
  "manifestSha256": "<derived-generation-binding-sha256>"
}
```

This object is written as `credentialGeneration` only after a successful
executed export. The same source and lifecycle digest produce the same binding;
any D1 content, R2 inventory, object body, or lifecycle digest change produces a
different binding. A failed or planned export cannot leave a falsely bound
manifest. All fields are redaction-safe digests or a schema version, not a
password, token, key, ciphertext, vault value, or client profile. Omitting the
flag preserves the existing unbound backup schema and scheduled-backup
behavior.

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

## Scheduled Remote Backup

The reviewed scheduled job lives in
`.github/workflows/remote-backup.yml`. It runs on manual
`workflow_dispatch` and daily at `17 19 * * *` UTC. The job performs a remote
D1 export, lists and downloads R2 objects under `attachments/`, emits a
secret-safe evidence packet, encrypts the backup directory, uploads only the
encrypted archive and evidence JSON as a short-retention GitHub Actions
artifact, and removes the plaintext backup directory from the runner.

Use the local packet command to review the schedule contract without reading or
printing secret values:

```sh
pnpm backup:schedule:packet
```

Required GitHub Actions secrets:

- `CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE`

The R2 S3-compatible access key ID and secret access key can be derived from
the D1/R2 scoped Cloudflare token when that token was created through the
Cloudflare token API:

- Access key ID: the Cloudflare API token id
- Secret access key: the SHA-256 hash of the Cloudflare API token value

Store those derived values only in ignored local env files or GitHub Actions
secrets. The current local operator setup stores them in
`~/.config/honowarden/cloudflare-scoped.env`, which is sourced by ignored
`.envrc.local`.

The scheduled job's encrypted artifact retention is `7` days. If a backup must
be retained beyond that window, copy the encrypted artifact to an
operator-owned restricted archive within `35` days. Do not store plaintext
backup archives in GitHub Actions artifacts, Linear, GitHub comments, or the
repository checkout.

Generate public evidence from an executed backup with:

```sh
pnpm backup:evidence -- \
  --from backups/prod-20260709T201114Z \
  --out test/.tmp/backup-evidence.json \
  --source-commit <git-sha> \
  --run-url <github-actions-run-url>
```

The evidence command verifies the nested generation binding and file checksums
before emitting a JSON packet. It records only aggregate fields such as manifest
id, optional derived credential-generation binding digest, D1 SQL checksum and
byte size, R2 object count, R2 object digest id, and total R2 byte size. It does
not emit the lifecycle digest, source-state digest, database names, bucket names,
object keys, SQL contents, object bodies, or secret values.

Failure handling:

1. Treat a scheduled workflow failure as an operator alert.
2. Use manual `workflow_dispatch` only after checking Cloudflare auth, account
   ID, R2 S3 credentials, D1 export health, and R2 listing health.
3. If D1 export succeeds but an R2 download fails, discard the partial backup
   directory and rerun after object access is fixed.
4. Repeated failures should be checkpointed in Linear and routed to the
   external alert sink once that sink exists.

Restore and rollback:

1. Do not restore over production during alpha.
2. Restore only into a fresh D1/R2 target or a fresh local `--persist-to`
   target.
3. If restore partially applies, discard the restore target and recreate it from
   the same backup instead of attempting in-place repair.
4. Record manifest id, evidence file path, source commit, target names, and
   verification results in the release or incident evidence.

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

Credential recovery must additionally pin both the exact executed backup
manifest and the credential-generation manifest recorded during export:

```sh
MANIFEST_SHA256=<backup-manifest-sha256>
GENERATION_BINDING_SHA256=<credentialGeneration.manifestSha256>

pnpm backup:restore -- \
  --from backups/final-generation \
  --database honowarden-restore \
  --bucket honowarden-restore-vault-objects \
  --mode local \
  --expected-manifest-sha256 "$MANIFEST_SHA256" \
  --expected-generation-manifest-sha256 "$GENERATION_BINDING_SHA256"
```

The generation expectation is accepted only together with an exact manifest
expectation. Dry-run inspection may omit both expectations, but executing any
manifest that contains `credentialGeneration` requires both approval pins even
when the operator did not supply either one. That gate runs before restore
command construction. A generic unbound backup remains restorable when neither
option is provided, and an exact manifest expectation may be used by itself for
an unbound backup.

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

For a generation-bound backup, retain both approval pins in the executed
command:

```sh
pnpm backup:restore -- \
  --from backups/final-generation \
  --database honowarden-restore \
  --bucket honowarden-restore-vault-objects \
  --mode local \
  --expected-manifest-sha256 "$MANIFEST_SHA256" \
  --expected-generation-manifest-sha256 "$GENERATION_BINDING_SHA256" \
  --execute \
  --confirm-fresh-target
```

Before executing any Wrangler command, restore checks:

- a generation-bound execution supplied both the exact manifest and generation
  approval pins
- the raw manifest bytes match `--expected-manifest-sha256`, when provided
- `credentialGeneration.manifestSha256` matches
  `--expected-generation-manifest-sha256`, when provided
- the nested source-state digest recomputes from the manifest's D1 checksum and
  sorted R2 key/body checksums
- the nested generation-manifest digest recomputes from the approved lifecycle
  digest and source-state digest
- manifest schema version and required fields
- manifest file paths are relative and cannot escape the backup directory
- R2 object files stay under `r2/`
- R2 object file names match the deterministic base64url encoding of their
  object keys
- every required file exists
- every required SHA-256 hash exists and matches the local file

Manifest identity and generation binding are read and hashed from the same byte
buffer. Both checks run in dry-run and execute modes before any restore command
is constructed, so a mismatched or historical source cannot start D1 import or
R2 upload. File-content checks continue to run immediately before command spawn
in `--execute` mode.

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
