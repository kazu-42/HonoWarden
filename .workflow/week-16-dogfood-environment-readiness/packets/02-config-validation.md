Packet ID: 02-config-validation
Objective: Enforce staging/production Wrangler config separation in CI.
Context: Week 16 dogfood can fail dangerously if staging and production point at the same deploy target or storage names.
Files / sources: `test/wrangler-environments.test.ts`, dependency metadata only if needed for JSONC parsing.
Ownership: Config validation test.
Do: Validate worker names, environment variables, D1 database names, R2 bucket names, and disabled bootstrap defaults.
Do not: Require live Cloudflare IDs while local config intentionally uses placeholders before resource creation.
Expected output: CI fails on obvious staging/production config drift.
Verification: `pnpm test`.
