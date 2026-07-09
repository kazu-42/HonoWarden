# Packet 01: Staging Deploy

## Scope

Apply pending D1 migrations and deploy the scheduled cleanup Worker to staging.

## Evidence

- Dry-run deploy passed.
- D1 migrated from `0001`-`0003` to `0001`-`0005`.
- Worker deployment ID: `7c18224d-feea-4e4e-9a53-aedd996273d5`
- Worker version ID: `35702116-2232-4236-9d81-dcc648ed2374`
- Deploy output included `schedule: 0 * * * *`.
- `/health`, `/healthz`, `/health/db`, `/api/config`, and synthetic prelogin
  denial passed after deploy.
