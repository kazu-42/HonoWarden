# HON-46 global request quotas

## Goal

Add an opt-in global request quota layer and secret-safe operator evidence for
abuse monitoring without weakening existing password-grant login defense.

## Scope

- Add a forward-only D1 migration for request quota buckets.
- Add request quota domain and repository code that stores hashed bucket keys,
  never plaintext client addresses.
- Add middleware that returns stable `429 rate_limited` only for exceeded
  buckets and `503 database_unavailable` for D1 failures.
- Keep the feature disabled by default in all Wrangler environments.
- Add a dry-run-first operator report for request quota and auth failure bucket
  metrics.
- Update operations, release, and security docs.

## Boundaries

- No production deployment.
- No production enablement of `HONOWARDEN_GLOBAL_REQUEST_QUOTA`.
- No external dashboard or alert route; HON-50 owns that integration.
- No per-user quota buckets in this slice.

## Verification

- Focused request quota domain, repository, app, CLI, migration, docs, schedule,
  and environment tests.
- Full repository quality gates before PR.
