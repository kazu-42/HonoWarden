# Worker Live Smoke Evidence

Target: `v0.1.0-alpha`.

Status: passed.

Mode: post-alpha Worker deploy and live HTTP smoke evidence.

This file records the API Worker deploy and live HTTP smoke evidence for the
published alpha release. It covers both staging and production Workers.

Do not mark this evidence as passed from local tests, staging dry-run output,
GitHub Actions status, or Cloudflare resource creation alone. Those checks are
useful prerequisites, but they do not prove that a live Worker is serving the
expected version.

## Execution Scope

- Standing operator approval: 2026-07-08, "approval いちいち確認しないで進めていいよ"
- Repository: `kazu-42/HonoWarden`
- Release tag: `v0.1.0-alpha`
- Release target commit:
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- Deployed source commit:
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- Release tag verification CI:
  `https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- Main CI readback for repository state before deploy evidence updates:
  `https://github.com/kazu-42/HonoWarden/actions/runs/28910664165`
- Wrangler version: `4.107.0`
- Cloudflare account: `gHive`
- Cloudflare account ID: `7e31a4cfe4ffd2cfff49c04236261de8`

An initial deploy was performed from `main`
`392637b3e277ba35057ba461cd82fac69013f603`. Because that commit is ahead of the
published release target and includes runtime diffs, staging and production were
redeployed from the release target commit above before this evidence was marked
passed.

No secrets were written. `HONOWARDEN_ALLOWED_EMAILS` remained empty, bootstrap
remained disabled, and audit logging remained disabled.

## Deployments

### Staging

- Environment: `staging`
- Worker name: `honowarden-staging`
- URL: `https://honowarden-staging.ghive42.workers.dev`
- Deployment ID: `ae336be4-169b-4a8a-a8c7-8d4b8ab7fa32`
- Current version ID: `bf0333dc-9efa-4001-aa31-20b3e10731c9`
- Candidate previous version ID:
  `f2357f14-8430-4b9f-913d-2dbad72322dd`
- Candidate status: pre-correction `main` deployment, not verified as the safe
  rollback target for this alpha evidence
- Approved rollback command: unresolved

### Production

- Environment: `production`
- Worker name: `honowarden`
- URL: `https://honowarden.ghive42.workers.dev`
- Deployment ID: `24f81b98-b761-4faa-aa78-cd773bb5d0c1`
- Current version ID: `72577dd9-c859-4673-b653-fbdd796f8f7d`
- Candidate previous version ID:
  `2c0b365b-3cf9-4766-ba8d-e5bd969c969d`
- Candidate status: pre-correction `main` deployment, not verified as the safe
  rollback target for this alpha evidence
- Approved rollback command: unresolved

## Commands Run

```sh
pnpm exec wrangler d1 migrations apply DB --env production --remote
git switch --detach e7a3c5ea9e51030143736bb0e7a36cb7a8babfce
pnpm exec wrangler deploy --env staging
pnpm exec wrangler deploy --env production
git switch main
```

The first production deploy was corrected by redeploying from the release target
commit. The production D1 migration apply completed `0001_initial_schema.sql`,
`0002_login_defenses.sql`, and `0003_totp_login.sql`.

## Live Smoke

### Staging

```sh
curl -fsS https://honowarden-staging.ghive42.workers.dev/health
curl -fsS https://honowarden-staging.ghive42.workers.dev/healthz
curl -fsS https://honowarden-staging.ghive42.workers.dev/health/db
curl -fsS https://honowarden-staging.ghive42.workers.dev/api/config
curl -sS -o /tmp/honowarden-staging-prelogin-release.json -w '%{http_code}\n' \
  -X POST https://honowarden-staging.ghive42.workers.dev/identity/accounts/prelogin \
  -H 'content-type: application/json' \
  --data '{"email":"alpha-smoke@example.invalid"}'
```

Redacted results:

- `/health`: `status=ok`, `version=0.1.0-alpha`, `environment=staging`
- `/healthz`: `status=ok`, `version=0.1.0-alpha`, `environment=staging`
- `/health/db`: `status=ok`, `schemaVersion=0003`, required tables present
- `/api/config`: `version=0.1.0-alpha`,
  `vault=https://honowarden-staging.ghive42.workers.dev`
- synthetic prelogin: HTTP `403`, `error.code=prelogin_not_allowed`

### Production

```sh
curl -fsS https://honowarden.ghive42.workers.dev/health
curl -fsS https://honowarden.ghive42.workers.dev/healthz
curl -fsS https://honowarden.ghive42.workers.dev/health/db
curl -fsS https://honowarden.ghive42.workers.dev/api/config
curl -sS -o /tmp/honowarden-production-prelogin-release.json -w '%{http_code}\n' \
  -X POST https://honowarden.ghive42.workers.dev/identity/accounts/prelogin \
  -H 'content-type: application/json' \
  --data '{"email":"alpha-smoke@example.invalid"}'
```

Redacted results:

- `/health`: `status=ok`, `version=0.1.0-alpha`, `environment=production`
- `/healthz`: `status=ok`, `version=0.1.0-alpha`, `environment=production`
- `/health/db`: `status=ok`, `schemaVersion=0003`, required tables present
- `/api/config`: `version=0.1.0-alpha`,
  `vault=https://honowarden.ghive42.workers.dev`
- synthetic prelogin: HTTP `403`, `error.code=prelogin_not_allowed`

## Limitations

- The Workers are available on `workers.dev` URLs. Custom domain routing is
  tracked separately in website/API route evidence.
- Public account registration remains disabled.
- No production secrets were written.
- Candidate previous-version handles are recorded, but approved rollback
  commands remain unresolved because the previous versions are pre-correction
  `main` deployments rather than verified safe rollback targets.

## Rollback

If deploy or smoke validation fails:

1. Stop promotion.
2. Redeploy the previous Worker version or remove the route, depending on the
   approved rollback plan.
3. Re-run `/health`, `/healthz`, and `/health/db` against the restored target.
4. Record the rollback timestamp and resulting health response.
