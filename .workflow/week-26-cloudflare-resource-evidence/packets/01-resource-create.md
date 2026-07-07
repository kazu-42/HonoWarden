# Packet 01: Resource Create

Objective: Create or verify Cloudflare D1/R2 resources and update local config.

Do:

- Confirm `pnpm wrangler whoami` is authenticated to gHive.
- Create staging and production D1 databases if absent.
- Create staging and production R2 buckets if absent.
- Update `wrangler.jsonc` with D1 IDs while preserving `DB` and
  `VAULT_OBJECTS` bindings.

Do not:

- Deploy Workers.
- Write secrets.
- Attach routes.

Verification:

- `pnpm wrangler d1 list`
- `pnpm wrangler r2 bucket list`
- `pnpm test -- test/wrangler-environments.test.ts`
