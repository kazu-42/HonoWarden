# Packet 01: Local Drill

## Objective

Execute a local synthetic backup and restore drill.

## Scope

- ignored `.wrangler` local D1 state
- ignored `test/.tmp/release-backup-drill-20260706T143928Z/**`

## Commands

```sh
printf 'y\n' | pnpm wrangler d1 migrations apply honowarden --local
pnpm backup:export --out test/.tmp/release-backup-drill-20260706T143928Z/backup --database honowarden --bucket honowarden-vault-objects --mode local --execute
pnpm backup:restore --from test/.tmp/release-backup-drill-20260706T143928Z/backup --database honowarden --bucket honowarden-restore-vault-objects --mode local --persist-to test/.tmp/release-backup-drill-20260706T143928Z/restore-state --execute --confirm-fresh-target
pnpm wrangler d1 execute honowarden --local --persist-to test/.tmp/release-backup-drill-20260706T143928Z/restore-state --command "select name from sqlite_master where type = 'table' order by name;"
```

## Acceptance

- Export exits zero.
- Restore exits zero.
- Restored table list includes the required alpha schema tables.
