# Spec: Week 02 D1 Schema And Database Health

## Summary

Week 02 introduces the first D1 schema and a database health check. The product still does not authenticate users or store real vault data, but it can prove that the expected schema has been migrated.

## Inputs

- `env.DB`: Cloudflare D1 database binding.
- `GET /health/db`: unauthenticated infrastructure health endpoint.

## Outputs

- Healthy database:
  - HTTP `200`
  - JSON body includes `status: "ok"`, `service: "honowarden"`, `database.schemaVersion`, and required table names.
- Unmigrated or unreachable database:
  - HTTP `503`
  - JSON body includes `status: "error"`, `service: "honowarden"`, and a stable error code.

## Behavior

1. The initial migration creates the minimum schema for future account, device, token, folder, and cipher work.
2. The migration records the current application schema version in `schema_migrations`.
3. `/health/db` reads the latest schema version.
4. `/health/db` confirms every required table exists.
5. `/health/db` does not expose secrets, encrypted payloads, or row-level data.

## Edge Cases

- If the migration metadata table is missing, the endpoint returns `503`.
- If any required table is missing, the endpoint returns `503`.
- If D1 throws, the endpoint returns `503` with a stable error code and no raw SQL details.

## Acceptance Criteria

- [x] `migrations/0001_initial_schema.sql` creates the required tables and indexes.
- [x] `getDatabaseHealth` returns healthy status for migrated schema metadata.
- [x] `getDatabaseHealth` returns unhealthy status for missing tables.
- [x] `GET /health/db` returns `200` for a healthy D1 binding.
- [x] `GET /health/db` returns `503` for missing migrations.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, and `pnpm format` pass.
