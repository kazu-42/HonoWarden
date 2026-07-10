# Fresh Deploy Guide

Target: `v0.1.0-alpha`.

Last updated: 2026-07-06.

This guide describes a fresh HonoWarden deploy to Cloudflare Workers, D1, and
R2. It is written for staging-first alpha validation. Production deployment
requires explicit operator approval.

## Prerequisites

- Node.js 22 or newer
- pnpm 11 or newer
- Wrangler authenticated to the intended Cloudflare account
- fresh D1 database for the target environment
- fresh R2 bucket for the target environment
- runtime secrets ready to set through Wrangler secret commands
- no real vault secrets in the test account

## Preflight

```sh
pnpm install --frozen-lockfile
pnpm audit --audit-level low
pnpm check
pnpm lint
pnpm test
pnpm compat:test
pnpm format
```

Confirm Wrangler identity and version:

```sh
pnpm wrangler whoami
pnpm wrangler --version
```

## Create Resources

For staging:

```sh
pnpm wrangler d1 create honowarden-staging
pnpm wrangler r2 bucket create honowarden-staging-vault-objects
```

For production:

```sh
pnpm wrangler d1 create honowarden
pnpm wrangler r2 bucket create honowarden-vault-objects
```

Replace placeholder `database_id` values in `wrangler.jsonc` only after the
resource names and account are confirmed.

## Set Secrets

Set secrets per environment. Do not put these values in `wrangler.jsonc`.

```sh
pnpm wrangler secret put HONOWARDEN_BOOTSTRAP_TOKEN --env staging
pnpm wrangler secret put HONOWARDEN_TOKEN_SECRET --env staging
pnpm wrangler secret put HONOWARDEN_TOTP_SECRET --env staging
pnpm wrangler secret put HONOWARDEN_AUTH_REQUEST_SECRET --env staging
```

Access-token key-id signing is optional on first deploy. If enabling staged
access-token key rotation, set all three keyring variables together and keep
`HONOWARDEN_TOKEN_SECRET` unchanged for refresh-token hashing and legacy no-kid
fallback:

```sh
pnpm wrangler secret put HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID --env staging
pnpm wrangler secret put HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET --env staging
pnpm wrangler secret put HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS --env staging
```

Set production secrets only after staging validation passes:

```sh
pnpm wrangler secret put HONOWARDEN_BOOTSTRAP_TOKEN --env production
pnpm wrangler secret put HONOWARDEN_TOKEN_SECRET --env production
pnpm wrangler secret put HONOWARDEN_TOTP_SECRET --env production
pnpm wrangler secret put HONOWARDEN_AUTH_REQUEST_SECRET --env production
```

For production staged access-token key rotation, repeat the same three keyring
secret commands only after the staging runbook in
`docs/operations/access-token-key-rotation.md` passes.

`HONOWARDEN_AUDIT_LOGS` remains `false` until log retention and access controls
are approved.

Keep `HONOWARDEN_AUTH_REQUESTS_ENABLED=false` until migration `0012`, the
dedicated secret, and staging create/approve/deny/poll/replay checks are all
verified. Production stays disabled until the staging evidence is recorded.

## Apply Migrations

Apply migrations to the target database:

```sh
pnpm wrangler d1 migrations apply honowarden-staging --env staging
```

For production:

```sh
pnpm wrangler d1 migrations apply honowarden --env production
```

After migration, verify:

```sh
pnpm wrangler d1 execute honowarden-staging --env staging --command "SELECT version FROM schema_migrations ORDER BY version;"
```

The result must include `0001`, `0002`, `0003`, `0004`, `0005`, `0006`,
`0007`, `0008`, and `0010`.

## Deploy Worker

Deploy staging first:

```sh
pnpm wrangler deploy --env staging
```

Production deployment:

```sh
pnpm wrangler deploy --env production
```

## Smoke Checks

Run these against the deployed URL:

- `GET /health`
- `GET /healthz`
- `GET /health/db`
- `GET /api/config`
- `POST /identity/accounts/prelogin` with an allowlisted synthetic email

For alpha validation, bootstrap only a synthetic account and verify login/sync
with synthetic vault items through official upstream clients.

## Evidence To Record

- commit SHA
- CI run URL
- Wrangler version
- Cloudflare account identity
- D1 database name and id
- R2 bucket name
- migration versions observed through `schema_migrations`
- health route responses with secrets removed
- compatibility matrix verification level
- backup/restore drill reference if production is being considered
