# HON-43 Scheduled Remote Backup Evidence

## Goal

Close HON-43 by adding a scheduled remote backup job, secret-safe executed
backup evidence, and a live remote D1/R2 backup drill with fresh-target restore
verification.

## Success Criteria

- A scheduled GitHub Actions workflow can run remote D1/R2 backup on manual
  dispatch and daily cron.
- Required GitHub Actions secrets are documented and configured by name.
- Remote R2 listing has a credential path that does not print secret values.
- Executed backup evidence includes manifest/checksum/count metadata but omits
  database names, bucket names, object keys, object bodies, SQL contents, and
  secret values.
- A live drill executes remote D1 export and R2 object backup using non-secret
  synthetic data.
- Restore verification runs into a fresh target and checks D1 and R2 outcomes.
- Local tests, gates, workflow verifier, PR CI, and main CI pass before Linear
  is moved to Done.

## Constraints

- Do not commit backup artifacts or secret material.
- Do not restore over production.
- Use encrypted scheduled artifacts with short retention.
- Keep long-term archive ownership explicit rather than pretending GitHub
  Actions artifacts are permanent backup storage.

## Work Packets

- `01-scheduled-job`: Add workflow and schedule packet.
- `02-secret-safe-evidence`: Add backup evidence command and tests.
- `03-live-drill`: Run remote backup/restore evidence and cleanup readback.
- `04-docs-verification`: Update docs, run local gates, PR, CI, and Linear.
