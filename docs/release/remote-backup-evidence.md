# Remote Backup Evidence

Target: `v0.1.0-alpha`.

Status: passed.

Mode: scheduled remote backup contract plus live remote D1/R2 backup and local
fresh-target restore drill.

Recorded at: 2026-07-09T20:12:07Z.

This evidence records the first HON-43 closeout for remote backup operations.
It proves the repository now contains a scheduled backup workflow, the required
GitHub Actions secrets are configured by name, a remote production D1 export can
execute, a remote R2 object can be captured, and the resulting backup can be
restored into a fresh local target. The drill used a temporary non-secret R2
object and deleted it from the production bucket after backup capture.

## Schedule And Ownership

- Workflow: `.github/workflows/remote-backup.yml`
- Trigger: `workflow_dispatch` and daily cron `17 19 * * *` UTC
- Owner: HonoWarden operator
- Encrypted artifact retention: `7` days in GitHub Actions
- Operator archive target: copy the encrypted artifact to operator-owned
  restricted storage within `35` days when long-term retention is required
- Plaintext backup policy: plaintext backup directories are runner-local only
  and removed in the workflow cleanup step

The workflow fails loudly when required secrets are missing. It does not attempt
restore. Restore remains a separate, explicit fresh-target operation.

## Secret Readback

The following GitHub Actions secret names were configured on
`kazu-42/HonoWarden` before closing this evidence. Values were not printed.

- `CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE`

The local operator env also stores the R2 S3-compatible access key ID and secret
access key in `~/.config/honowarden/cloudflare-scoped.env`. The R2 secret access
key is derived from the D1/R2 scoped token value as documented by Cloudflare's
R2 authentication guide; the derived value is not committed.

## Live Remote Backup Drill

The drill used `wrangler 4.107.0` and the D1/R2 scoped Cloudflare token.

Source commit supplied to the evidence packet:
`b3e2c33cf9f0560c9f11224cb67c688d24445eb5`.

Workflow branch at the time of the drill:
`codex/hon-43-scheduled-backup-evidence`.

Commands performed:

```sh
pnpm exec wrangler r2 object put honowarden-vault-objects/<synthetic-hon-43-object> --remote --env production --file test/.tmp/hon-43-live-drill-20260709T201114Z/source-object.txt
pnpm backup:export -- --out test/.tmp/hon-43-live-drill-20260709T201114Z/backup --database honowarden --bucket honowarden-vault-objects --mode remote --env production --r2-objects test/.tmp/hon-43-live-drill-20260709T201114Z/objects.txt --execute
pnpm backup:evidence -- --from test/.tmp/hon-43-live-drill-20260709T201114Z/backup --out test/.tmp/hon-43-live-drill-20260709T201114Z/backup-evidence.json --source-commit b3e2c33cf9f0560c9f11224cb67c688d24445eb5 --run-url https://github.com/kazu-42/HonoWarden/actions/runs/local-hon-43-live-drill
pnpm backup:restore -- --from test/.tmp/hon-43-live-drill-20260709T201114Z/backup --database honowarden --bucket honowarden-restore-vault-objects --mode local --persist-to test/.tmp/hon-43-live-drill-20260709T201114Z/restore-state-2 --execute --confirm-fresh-target
pnpm exec wrangler r2 object delete honowarden-vault-objects/<synthetic-hon-43-object> --remote --env production --force
```

The backup command executed a remote D1 export and downloaded one temporary
non-secret R2 object listed through an explicit object-list file. The normal
`attachments/` prefix was also checked with remote listing before the drill and
returned zero objects, so a temporary object was required to prove R2 restore
behavior without using real vault data.

## Secret-Safe Backup Evidence

The committed evidence contains only aggregate fields from
`pnpm backup:evidence`. It excludes database names, bucket names, object keys,
object bodies, SQL contents, and secret values.

- Manifest ID:
  `sha256:20de055a2753f125252c8dcd0f46776f0aa99bac7df04c7de8b8d58f7913eb6b`
- D1 SQL SHA-256:
  `89f4318e7bf6d0277a2678fdfa8f3880c03968e5f081c2df437bf776611423f4`
- D1 SQL size: `5993` bytes
- R2 object count: `1`
- R2 object digest ID:
  `sha256:70702afd86001edde7e3f600f4f4e74e5784719178847bf3c2e74d59da300f1a`
- R2 total size: `59` bytes
- Evidence safety flags:
  `includesDatabaseName=false`, `includesBucketName=false`,
  `includesObjectKeys=false`, `includesObjectBodies=false`

## Restore Verification

Restore was executed into a fresh local persistence target:
`test/.tmp/hon-43-live-drill-20260709T201114Z/restore-state-2`.

Verification results:

- D1 import completed successfully with `36` SQL commands executed.
- Restored D1 table count: `13`.
- Restored R2 object SHA-256:
  `eb32ce8dc35b7f74332c367af1c99c0608c9d037aaf124e57278e5c491064f9f`
- The restored R2 object checksum matched the backed-up synthetic object.
- A post-cleanup remote get for the temporary production object failed with
  `The specified key does not exist`, confirming cleanup.

## Failure Handling

Alert sources:

- GitHub Actions scheduled workflow failure notification
- manual Linear checkpoint for repeated backup failures
- future external alert sink after HON-49

Retry policy:

- Use `workflow_dispatch` for a manual rerun after verifying Cloudflare auth,
  R2 S3 credentials, account ID, and recent R2/D1 service health.
- If remote D1 export succeeds but R2 object download fails, discard the partial
  backup directory and rerun after object access is fixed.

Restore and rollback policy:

- Never restore over the source production D1/R2 resources during alpha.
- Restore only into fresh targets.
- If a restore partially applies, discard the restore target and recreate it
  from the same backup instead of attempting in-place repair.

## Limitations

- The scheduled workflow cannot be observed on `main` until this PR is merged.
  The repository secrets are already configured, and the workflow is ready for
  manual dispatch or the next cron after merge.
- The restore target in this drill was local, not a remote disposable
  Cloudflare D1/R2 pair.
- The R2 object was synthetic and non-secret. This proves object backup/restore
  mechanics, not a live official-client attachment workflow.
- Backup artifacts under `test/.tmp` are ignored and must not be committed.
