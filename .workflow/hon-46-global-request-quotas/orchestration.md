# Orchestration: HON-46 global request quotas

## Steps

1. Add red tests for request quota buckets, middleware, migration, CLI, and docs.
2. Implement the minimal request quota domain, repository, migration, middleware,
   and operator report.
3. Keep feature activation explicit and disabled by default.
4. Update docs and release evidence.
5. Run focused and full verification.

## Safety Checks

- Bucket keys must be generated hashes and must not include plaintext client
  addresses.
- Database failures must not be hidden as quota exceeded responses.
- Health probes and CORS preflight must not be counted.
- Scheduled cleanup must touch request quota buckets only when the feature is
  enabled.
