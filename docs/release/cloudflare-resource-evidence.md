# Cloudflare Resource Evidence

Target: `v0.1.0-alpha`.

Date: 2026-07-07.

Status: passed.

Mode: Cloudflare resource creation and verification.

This evidence records the non-secret Cloudflare resources created for
HonoWarden alpha readiness. It covers D1 and R2 resources plus staging D1
migrations. It does not claim Worker deployment, route binding, secret writes,
or live HTTP smoke.

## Account

- Account name: `gHive`
- Account ID: `7e31a4cfe4ffd2cfff49c04236261de8`
- Wrangler version: `4.107.0`
- Auth method observed: OAuth token

## Resources

- Staging D1: `honowarden-staging`
- Staging D1 ID: `95cd44de-809f-473c-9972-f892fa32ceb8`
- Staging D1 location hint: `apac`
- Production D1: `honowarden`
- Production D1 ID: `21ef7fa8-f26d-4024-82cb-c7b88ee02433`
- Production D1 location hint: `apac`
- Staging R2: `honowarden-staging-vault-objects`
- Production R2: `honowarden-vault-objects`
- R2 location hint: `apac`

The D1 IDs above are recorded in `wrangler.jsonc` with the established `DB`
binding. R2 bucket names are recorded with the established `VAULT_OBJECTS`
binding.

## Commands

```sh
pnpm wrangler d1 create honowarden-staging --location apac
pnpm wrangler d1 create honowarden --location apac
pnpm wrangler r2 bucket create honowarden-staging-vault-objects --location apac
pnpm wrangler r2 bucket create honowarden-vault-objects --location apac
printf 'y\n' | pnpm wrangler d1 migrations apply honowarden-staging --env staging --remote
```

The same migration command was first run without `--remote`; Wrangler applied it
to local state only. That local run is not used as release evidence.

## Verification

Resource listing showed both D1 databases:

```text
21ef7fa8-f26d-4024-82cb-c7b88ee02433  honowarden
95cd44de-809f-473c-9972-f892fa32ceb8  honowarden-staging
```

Resource listing showed both R2 buckets:

```text
honowarden-staging-vault-objects
honowarden-vault-objects
```

Remote staging migration verification:

```sh
pnpm wrangler d1 execute honowarden-staging --env staging --remote --command "select version from schema_migrations order by version;"
```

Staging remote migrations: `0001`, `0002`, `0003`.

Remote staging schema table verification included:

```text
auth_attempts
auth_failure_buckets
ciphers
d1_migrations
devices
folders
refresh_tokens
schema_migrations
totp_challenges
user_totp
users
```

## Not Performed

- Worker deploy: not performed.
- Secret writes: not performed.
- Route writes: not performed.
- Production migration apply: not performed.
- Live HTTP smoke: not performed.
- Live client evidence: not performed.

## Rollback

Rollback:

1. Do not deploy a Worker that references the resources if resource validation
   fails.
2. Delete the empty production D1 and R2 resources before any production data is
   written.
3. For staging, export evidence first if debugging is needed, then delete the
   staging D1 and R2 resources and recreate them from this document.
4. If a Worker is deployed later, roll Worker code back separately from data
   rollback. Do not restore over the original source database during alpha.
