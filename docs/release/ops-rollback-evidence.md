# Operations Rollback Evidence

Target: `v0.1.0-alpha`.

Status: passed.

Mode: post-alpha rollback handle and recovery evidence.

This file records rollback readiness after Worker deploy, website route changes,
or Email Routing changes. It is marked `passed` because the API Worker
previous-version candidates were explicitly rejected as unsafe rollback targets,
an incident-specific release-target redeploy strategy was recorded, and a
non-mutating rollback rehearsal recorded live health checks and a continue
decision.

Rollback readiness is separate from release publication, CI success, and local
dry-run output.

## API Worker Previous-Version Handles

Standing operator approval was provided on 2026-07-08. API Worker deploys were
completed after the alpha GitHub Release was published and verified.

### Staging API Worker

- Current version: `bf0333dc-9efa-4001-aa31-20b3e10731c9`
- Current deployment: `ae336be4-169b-4a8a-a8c7-8d4b8ab7fa32`
- Current deployment readback: `2026-07-09T14:10Z`, version receiving `100%`
  traffic
- Candidate previous version: `f2357f14-8430-4b9f-913d-2dbad72322dd`
- Candidate status: pre-correction `main` deployment, not verified as the safe
  rollback target
- Approved recovery command: redeploy the reviewed release target commit with
  `pnpm exec wrangler deploy --env staging`

### Production API Worker

- Current version: `72577dd9-c859-4673-b653-fbdd796f8f7d`
- Current deployment: `24f81b98-b761-4faa-aa78-cd773bb5d0c1`
- Current deployment readback: `2026-07-09T14:10Z`, version receiving `100%`
  traffic
- Candidate previous version: `2c0b365b-3cf9-4766-ba8d-e5bd969c969d`
- Candidate status: pre-correction `main` deployment, not verified as the safe
  rollback target
- Approved recovery command: redeploy the reviewed release target commit with
  `pnpm exec wrangler deploy --env production`

The candidate previous versions are known deployable Worker versions, but they
are the pre-correction deployments from `main`
`392637b3e277ba35057ba461cd82fac69013f603`, not the alpha release target. Do
not treat them as approved rollback targets without an incident-specific
decision. The approved incident-specific recovery strategy for the alpha lane is
to redeploy release target commit
`e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`, not to roll back to the
pre-correction Worker versions.

## API Worker Recovery Strategy

Use this strategy when the current alpha Worker deployment is unhealthy but D1
schema state remains compatible with `v0.1.0-alpha`.

1. Hold promotion and stop optional write traffic where possible.
2. Check out the reviewed release target commit.
3. Re-run the deploy dry-run for the affected environment.
4. Redeploy the release target to the affected environment.
5. Re-run `/health`, `/healthz`, `/health/db`, `/api/config`, and synthetic
   prelogin denial checks.
6. Record the resulting deployment ID, Worker version ID, health responses, and
   continue/rollback/hold decision.

Commands:

```sh
git switch --detach e7a3c5ea9e51030143736bb0e7a36cb7a8babfce
pnpm exec wrangler deploy --env staging --dry-run --outdir test/.tmp/rollback-rehearsal/staging
pnpm exec wrangler deploy --env staging

git switch --detach e7a3c5ea9e51030143736bb0e7a36cb7a8babfce
pnpm exec wrangler deploy --env production --dry-run --outdir test/.tmp/rollback-rehearsal/production
pnpm exec wrangler deploy --env production
```

Do not run `pnpm exec wrangler rollback f2357f14-8430-4b9f-913d-2dbad72322dd`
or `pnpm exec wrangler rollback 2c0b365b-3cf9-4766-ba8d-e5bd969c969d` for the
alpha lane without a new incident decision. Those versions are the
pre-correction `main` deployments and are not approved safe rollback targets.

## API Worker Rollback Rehearsal: 2026-07-09

Rehearsal type: non-mutating release-target dry-run, Cloudflare deployment
readback, live health checks, and decision record. No traffic-changing rollback
or redeploy was executed because the current live deployment was healthy and the
candidate previous Worker versions are not approved rollback targets.

Dry-run source:

- Commit: `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- Local worktree: `test/.tmp/rollback-release-target`
- Wrangler version: `4.107.0`
- Output directory: `test/.tmp/rollback-rehearsal`

Dry-run results:

| Environment | Command                                                                                                 | Result | Bundle output                                |
| ----------- | ------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| staging     | `pnpm exec wrangler deploy --env staging --dry-run --outdir test/.tmp/rollback-rehearsal/staging`       | passed | `Total Upload: 188.61 KiB / gzip: 37.52 KiB` |
| production  | `pnpm exec wrangler deploy --env production --dry-run --outdir test/.tmp/rollback-rehearsal/production` | passed | `Total Upload: 188.61 KiB / gzip: 37.52 KiB` |

Cloudflare deployment readback:

| Environment | Deployment ID                          | Version ID                             | Traffic | Created                       |
| ----------- | -------------------------------------- | -------------------------------------- | ------- | ----------------------------- |
| staging     | `ae336be4-169b-4a8a-a8c7-8d4b8ab7fa32` | `bf0333dc-9efa-4001-aa31-20b3e10731c9` | `100%`  | `2026-07-08T01:42:32.992153Z` |
| production  | `24f81b98-b761-4faa-aa78-cd773bb5d0c1` | `72577dd9-c859-4673-b653-fbdd796f8f7d` | `100%`  | `2026-07-08T01:42:43.738247Z` |

Live health checks:

| Environment | Check              | Result                                                                   |
| ----------- | ------------------ | ------------------------------------------------------------------------ |
| staging     | `/health`          | HTTP `200`, `status=ok`, `version=0.1.0-alpha`, `environment=staging`    |
| staging     | `/healthz`         | HTTP `200`, `status=ok`, `version=0.1.0-alpha`, `environment=staging`    |
| staging     | `/health/db`       | HTTP `200`, `schemaVersion=0003`, required alpha tables present          |
| staging     | `/api/config`      | HTTP `200`, `version=0.1.0-alpha`, vault points to staging Worker URL    |
| staging     | synthetic prelogin | HTTP `403`, `error.code=prelogin_not_allowed`                            |
| production  | `/health`          | HTTP `200`, `status=ok`, `version=0.1.0-alpha`, `environment=production` |
| production  | `/healthz`         | HTTP `200`, `status=ok`, `version=0.1.0-alpha`, `environment=production` |
| production  | `/health/db`       | HTTP `200`, `schemaVersion=0003`, required alpha tables present          |
| production  | `/api/config`      | HTTP `200`, `version=0.1.0-alpha`, vault points to production Worker URL |
| production  | synthetic prelogin | HTTP `403`, `error.code=prelogin_not_allowed`                            |

Decision: `continue`. Hold actual rollback or redeploy until an incident exists.
If an incident occurs, use the release-target redeploy strategy above unless a
newer verified safe target is selected and recorded.

## Website Previous-Version Handle

Standing operator approval was provided on 2026-07-08. The website deployment
was performed from `kazu-42/HonoWarden-website` after PR #1 passed CI and was
merged.

- Website merge commit: `36b8171f7afd55bf306e5482cca454a0b3822a39`
- Current deployment: `0f398ae5-6d01-42a8-bbe4-35378661ce81`
- Current version: `eef4ab71-d6e8-401f-93c3-27e7bd2bcd91`
- Current deployment readback: `2026-07-09T14:10Z`, version receiving `100%`
  traffic
- Previous deployment: `5b1f701c-4654-46e5-bca7-09de61316783`
- Previous version: `3db432cb-6422-4311-b558-6eb2b0b5bb51`
- Previous status: known-good public website deployment that did not advertise
  an active unverified security mailbox
- Rollback command:
  `pnpm exec wrangler rollback 3db432cb-6422-4311-b558-6eb2b0b5bb51 --name honowarden-website --yes`
- Rollback execution: not performed because post-deploy website smoke passed

Website health recheck during rollback rehearsal:

- `https://honowarden.com/`: HTTP `200`, HTML content type, CSP/HSTS present,
  `x-frame-options: DENY`
- `https://www.honowarden.com/`: HTTP `200`, HTML content type, CSP/HSTS
  present, `x-frame-options: DENY`
- `https://honowarden.com/health`: HTTP `200`,
  `{"status":"ok","service":"honowarden-website"}`
- `https://www.honowarden.com/health`: HTTP `200`,
  `{"status":"ok","service":"honowarden-website"}`
- `/.well-known/security.txt`: HTTP `404` on apex and `www`, matching the
  current security-contact visibility decision

## Email Routing Rollback Handle

Email Routing was enabled on 2026-07-09 after operator approval. Pre-change
readback from 2026-07-08 showed no MX records and no apex TXT records for
`honowarden.com`.

- `honowarden.com` nameservers: `anna.ns.cloudflare.com`,
  `damon.ns.cloudflare.com`
- Current Email Routing state: `enabled: true`, API status `ready`
- Current destination count: `1`, verified destination tag `e732fc786e52`
- Destination address value is intentionally not recorded
- Inbound smoke status: `passed`
- Rollback execution: not performed because route/DNS readback and inbound
  smoke passed

Route rollback handles:

| Address                     | Rule ID                            |
| --------------------------- | ---------------------------------- |
| `security@honowarden.com`   | `c303ee9d52e94355a6a5c0680163927c` |
| `support@honowarden.com`    | `f9821e487f1d4e6e989f0fca1fb5ea6b` |
| `hello@honowarden.com`      | `e9d2b80c19cf47038165b15282c68eb4` |
| `admin@honowarden.com`      | `0d3aea1c4e13401085cf7c6be2b7ac00` |
| `postmaster@honowarden.com` | `f44abae45fc749f9a99e8945ad46e994` |
| `abuse@honowarden.com`      | `b9d2bf82f1bc41f688299e8be617c7dd` |

DNS rollback handles:

| Type | Record ID                          | Content                                        | Priority |
| ---- | ---------------------------------- | ---------------------------------------------- | -------- |
| MX   | `04fa6f6528ab56d9d2b3d6fbd8fa9ded` | `route3.mx.cloudflare.net`                     | `28`     |
| MX   | `62a4125f5191bf644e1723cceb04839f` | `route2.mx.cloudflare.net`                     | `35`     |
| MX   | `d1df42e54f0d39facf12ff0e4a6f0668` | `route1.mx.cloudflare.net`                     | `63`     |
| TXT  | `905639146eeaf7449af796d7bef2a8ab` | `"v=spf1 include:_spf.mx.cloudflare.net ~all"` | n/a      |

If inbound delivery fails and the decision is to revert to the pre-change email
posture, disable the Email Routing rules first, then disable Email Routing for
the zone. If the disable operation does not remove the MX/SPF records, delete
the DNS records by the IDs above. Keep `security@honowarden.com` unadvertised
until a successful inbound test is recorded.

## Evidence To Record

For each approved operation, record:

- approval text and timestamp
- operation owner
- environment
- commit SHA or configuration version before the operation
- commit SHA or configuration version after the operation
- previous Worker deployment id or route target
- previous website deployment id or route target
- previous DNS record state, if DNS changed
- previous Email Routing rule state, if email changed
- exact rollback command or Cloudflare dashboard path
- health checks after rollback rehearsal or actual rollback
- decision to continue, rollback, or hold

Do not record secret values, private forwarding destinations, or real vault
data.

## Rollback Commands To Fill In

API Worker:

```sh
git switch --detach e7a3c5ea9e51030143736bb0e7a36cb7a8babfce
pnpm exec wrangler deploy --env staging --dry-run --outdir test/.tmp/rollback-rehearsal/staging
pnpm exec wrangler deploy --env staging

git switch --detach e7a3c5ea9e51030143736bb0e7a36cb7a8babfce
pnpm exec wrangler deploy --env production --dry-run --outdir test/.tmp/rollback-rehearsal/production
pnpm exec wrangler deploy --env production
```

Website:

```sh
pnpm exec wrangler rollback 3db432cb-6422-4311-b558-6eb2b0b5bb51 --name honowarden-website --yes
```

Email Routing:

```sh
# Disable or delete the six forwarding rules by rule id, then disable Email
# Routing. If DNS remains after disabling Email Routing, delete the MX/SPF
# records by DNS record id.
#
# Example API paths:
# DELETE /zones/$CLOUDFLARE_ZONE_ID_HONOWARDEN_COM/email/routing/rules/<rule-id>
# POST /zones/$CLOUDFLARE_ZONE_ID_HONOWARDEN_COM/email/routing/disable
# DELETE /zones/$CLOUDFLARE_ZONE_ID_HONOWARDEN_COM/dns_records/<record-id>
```

## Not Performed

- Actual API Worker traffic-changing rollback or redeploy was not performed
  because live health checks passed.
- Website route rollback has not been performed by this evidence file because
  post-deploy smoke passed.
- Email Routing rollback has not been performed by this evidence file.
- DNS rollback has not been performed by this evidence file.

## Completion Criteria

This evidence is marked `passed` because:

1. The relevant operations had standing operator approval.
2. Unsafe previous API Worker versions were rejected and an incident-specific
   release-target redeploy strategy was selected.
3. Concrete Worker redeploy, website rollback, and Email Routing rollback
   commands or handles are recorded.
4. Rehearsal health, route, and email-readback checks were recorded with a
   `continue` decision.
5. No secrets, private forwarding destinations, message bodies, or real vault
   data are included.
