# Worker Live Smoke Evidence

> **HISTORICAL EVIDENCE — NOT CURRENT EXECUTION AUTHORITY.** This document
> records the 2026-07 `v0.1.0-alpha` Worker deployments and then-live HTTP
> observations. It does not establish current deployment, health, schema,
> configuration, traffic, or rollback state, and it does not authorize a D1
> migration, Worker upload, activation, rollback, route change, or traffic
> change. Current Worker execution remains STOP unless a future remote-write
> protocol satisfies the admission boundary in
> [Build provenance and deployment authority](../operations/deploy-provenance-runbook.md#admission-requirements-for-a-future-remote-write-protocol)
> and receives separate, one-shot authority.

Historical target: `v0.1.0-alpha`.

Historical status: passed.

Historical mode: post-alpha Worker deployment and live HTTP smoke evidence.

This file records what was observed for the published alpha release in staging
and production. The historical `passed` result cannot be carried forward: a
current status claim requires fresh, secret-safe deployment and HTTP readback
under separately admitted read-only authority. Local tests, staging dry-run
output, GitHub Actions status, or Cloudflare resource creation alone never prove
that a live Worker currently serves the expected version.

## Historical Execution Scope

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
- Historical recovery proposal: redeploy release target commit
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`. The proposal is not an
  executable current procedure; see
  [Operations Rollback Evidence](ops-rollback-evidence.md)

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
- Historical recovery proposal: redeploy release target commit
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`. The proposal is not an
  executable current procedure; see
  [Operations Rollback Evidence](ops-rollback-evidence.md)

## Historical Mutation Record

The 2026-07 operation applied the first three production D1 migrations and
deployed the release-target source to staging and production. The first
production deployment was corrected by redeploying from release-target commit
`e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`. The recorded migrations were
`0001_initial_schema.sql`, `0002_login_defenses.sql`, and
`0003_totp_login.sql`.

The obsolete mutation command sequence has been removed deliberately. This
record preserves the outcome and source identity without leaving an executable
deployment or migration recipe that could be mistaken for current authority.

## Historical Live Smoke

The commands below are the read-only HTTP probes recorded in 2026-07. Their
results are historical observations, not current endpoint-health evidence.

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

## Historical Limitations

- The Workers were observed on `workers.dev` URLs. Custom domain routing was
  tracked separately in website/API route evidence.
- Public account registration was disabled in the observed configuration.
- No production secrets were written during the recorded operation.
- Candidate previous-version handles are recorded, but they are not approved
  current rollback targets because the previous versions were pre-correction
  `main` deployments. The historical proposal to redeploy the reviewed release
  target commit is recorded, without an executable command, in
  [Operations Rollback Evidence](ops-rollback-evidence.md).

## Historical Rollback Disposition

No traffic-changing rollback was performed because the recorded smoke checks
passed. The previous-version candidates were rejected as unsafe recovery
targets. Any current incident must preserve remote state, capture fresh
readback, and enter through the future remote-write admission boundary; the
2026-07 approval and recovery proposal must not be reused.
