# Packet 02: Production Deploy

## Scope

Apply pending D1 migrations and deploy the scheduled cleanup Worker to
production after staging passes.

## Evidence

- Dry-run deploy passed.
- D1 migrated from `0001`-`0003` to `0001`-`0005`.
- Worker deployment ID: `b7e1fec2-75ef-4728-8126-0346977589a7`
- Worker version ID: `96a2c5d1-7fce-42cf-8ab1-5709b69fe83c`
- Deploy output included `schedule: 0 * * * *`.
- `/health`, `/healthz`, `/health/db`, `/api/config`, and synthetic prelogin
  denial passed after deploy.
