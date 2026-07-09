# Result 01: Staging Deploy

## Outcome

Staging D1 migrations and Worker deploy passed.

## Evidence

- Dry-run deploy: passed
- D1 schema before deploy: `0001`, `0002`, `0003`
- D1 schema after migration: `0001`, `0002`, `0003`, `0004`, `0005`
- Worker deployment ID: `7c18224d-feea-4e4e-9a53-aedd996273d5`
- Worker version ID: `35702116-2232-4236-9d81-dcc648ed2374`
- Traffic: `100%`
- Schedule readback from deploy output: `0 * * * *`
- Health smoke: `/health`, `/healthz`, `/health/db`, `/api/config`, and
  synthetic prelogin HTTP `403` passed
