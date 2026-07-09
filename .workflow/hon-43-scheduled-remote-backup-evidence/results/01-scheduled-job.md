# Result 01: Scheduled Job

## Accepted

- Added `.github/workflows/remote-backup.yml`.
- Added `pnpm backup:schedule:packet`.
- Workflow uses `workflow_dispatch` and daily `17 19 * * *` UTC cron.
- Workflow encrypts backup archives with `openssl enc -aes-256-cbc -pbkdf2`.
- Workflow uploads only the encrypted archive and evidence JSON with 7-day
  retention.

## Rejected

- No restore step is included in the scheduled workflow.
- No plaintext backup artifact upload is allowed.
