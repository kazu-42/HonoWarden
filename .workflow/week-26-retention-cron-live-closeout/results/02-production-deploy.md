# Result 02: Production Deploy

## Outcome

Production D1 migrations and Worker deploy passed after staging smoke.

## Evidence

- Dry-run deploy: passed
- D1 schema before deploy: `0001`, `0002`, `0003`
- D1 schema after migration: `0001`, `0002`, `0003`, `0004`, `0005`
- Worker deployment ID: `b7e1fec2-75ef-4728-8126-0346977589a7`
- Worker version ID: `96a2c5d1-7fce-42cf-8ab1-5709b69fe83c`
- Traffic: `100%`
- Schedule readback from deploy output: `0 * * * *`
- Health smoke: `/health`, `/healthz`, `/health/db`, `/api/config`, and
  synthetic prelogin HTTP `403` passed
