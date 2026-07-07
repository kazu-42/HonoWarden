# Final Report: Week 26 Cloudflare Resource Evidence

## Outcome

Cloudflare D1/R2 resource evidence is recorded for the alpha release gate.
Release gate now passes the Cloudflare resource check and keeps only
live-client evidence blocked.

## Accepted Results

- Created staging and production D1 databases in the gHive account.
- Created staging and production R2 buckets in the gHive account.
- Replaced D1 placeholder IDs in `wrangler.jsonc`.
- Applied remote staging D1 migrations through `0003`.
- Verified remote staging migration versions and schema tables.
- Added `docs/release/cloudflare-resource-evidence.md`.
- Tightened release gate validation for resource evidence fields and
  non-placeholder D1 IDs.
- Added config coverage proving deployable D1 IDs are real and separated.

## Rejected Results

- Did not deploy Workers.
- Did not write secrets.
- Did not attach routes.
- Did not apply production migrations.
- Did not claim live HTTP smoke or live client evidence.

## Conflicts Resolved

Wrangler first applied migrations locally when `--remote` was omitted. That run
is documented and excluded from release evidence; the migration command was
rerun with `--remote` and verified against the remote staging database.

## Verification Evidence

- `pnpm wrangler whoami`
- `pnpm wrangler d1 list`
- `pnpm wrangler r2 bucket list`
- `pnpm wrangler d1 execute honowarden-staging --env staging --remote --command "select version from schema_migrations order by version;"`
- `pnpm wrangler d1 execute honowarden-staging --env staging --remote --command "select name from sqlite_master where type = 'table' order by name;"`
- `pnpm release:gate`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scans
- workflow verifier
- GitHub Actions CI run `28833277441`: passed

## Remaining Risks

- Live client evidence remains fixture-only.
- Worker deployment, secret writes, route writes, production migrations, and
  deployed HTTP smoke remain undone.

## Reusable Follow-up

Before a Worker deploy, set staging secrets, keep bootstrap fail-closed unless
explicitly bootstrapping a synthetic account, then run staging HTTP smoke and
live-client evidence against synthetic data only.
