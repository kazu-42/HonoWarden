# Packet: request quota core

Implement migration, domain, repository, middleware, and cleanup wiring for the
opt-in global request quota.

Acceptance:

- hashed bucket keys only
- stable 429 for exceeded buckets
- 503 for D1 failures
- health and CORS preflight bypass
