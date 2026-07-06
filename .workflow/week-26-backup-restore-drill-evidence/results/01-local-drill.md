# Result 01: Local Drill

## Accepted

- Applied local D1 migrations to `honowarden`.
- Executed local backup export into
  `test/.tmp/release-backup-drill-20260706T143928Z/backup`.
- Executed local restore into
  `test/.tmp/release-backup-drill-20260706T143928Z/restore-state`.
- Verified restored table list with Wrangler D1 execute.
- Recorded D1 SQL SHA-256:
  `562fc6a06acaa6056c727d162ac74768b16fa833f05db3a04769061cde966eac`.

## Rejected

- Did not run remote backup/restore.
- Did not include R2 object restore evidence because the local object list was
  empty.
