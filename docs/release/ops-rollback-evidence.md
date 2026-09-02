# Operations Rollback Evidence

> **HISTORICAL EVIDENCE — NOT CURRENT EXECUTION AUTHORITY.** This document
> records observations and decisions made for the 2026-07 `v0.1.0-alpha`
> release. It does not authorize or define a current Worker deploy, rollback,
> traffic change, website rollback, DNS change, or Email Routing change. Do not
> copy commands from this record into an active operation. Current Worker
> recovery remains STOP unless a future remote-write protocol satisfies the
> admission boundary in [Build provenance and deployment authority](../operations/deploy-provenance-runbook.md#admission-requirements-for-a-future-remote-write-protocol)
> and receives separate, one-shot authority.

Historical target: `v0.1.0-alpha`.

Historical status: passed.

Historical mode: post-alpha rollback-handle and recovery evidence.

This file recorded rollback readiness after Worker deployment, website route
changes, and Email Routing changes. It was marked `passed` because the API Worker
previous-version candidates were explicitly rejected as unsafe rollback targets,
an incident-specific release-target redeploy proposal was recorded, and a
non-mutating rollback rehearsal recorded then-live health checks and a
`continue` decision.

That historical readiness result was separate from release publication, CI
success, and local dry-run output. It does not establish present readiness.

## API Worker Previous-Version Handles

Standing operator approval was provided on 2026-07-08. API Worker deployments
were completed after the alpha GitHub Release was published and verified.

### Staging API Worker

- Observed version: `bf0333dc-9efa-4001-aa31-20b3e10731c9`
- Observed deployment: `ae336be4-169b-4a8a-a8c7-8d4b8ab7fa32`
- Deployment readback at `2026-07-09T14:10Z`: version received `100%` traffic
- Candidate previous version: `f2357f14-8430-4b9f-913d-2dbad72322dd`
- Candidate status: pre-correction `main` deployment, not verified as the safe
  rollback target
- Historical recovery proposal: redeploy the reviewed release-target commit.
  This proposal did not confer current authority and was not an executable
  procedure.

### Production API Worker

- Observed version: `72577dd9-c859-4673-b653-fbdd796f8f7d`
- Observed deployment: `24f81b98-b761-4faa-aa78-cd773bb5d0c1`
- Deployment readback at `2026-07-09T14:10Z`: version received `100%` traffic
- Candidate previous version: `2c0b365b-3cf9-4766-ba8d-e5bd969c969d`
- Candidate status: pre-correction `main` deployment, not verified as the safe
  rollback target
- Historical recovery proposal: redeploy the reviewed release-target commit.
  This proposal did not confer current authority and was not an executable
  procedure.

The candidate previous versions were known deployable Worker versions, but they
were the pre-correction deployments from `main`
`392637b3e277ba35057ba461cd82fac69013f603`, not the alpha release target. They
were not treated as approved rollback targets. The historical incident-specific
proposal selected release-target commit
`e7a3c5ea9e51030143736bb0e7a36cb7a8babfce` instead of the pre-correction
Worker versions; it was not executed and confers no present authority.

## Historical API Worker Recovery Decision

The 2026-07 decision rejected previous versions
`f2357f14-8430-4b9f-913d-2dbad72322dd` and
`2c0b365b-3cf9-4766-ba8d-e5bd969c969d` as safe rollback targets because they
were pre-correction `main` deployments. The team documented a release-target
redeploy proposal, but no traffic-changing rollback or redeploy was performed.

The old proposal was deliberately removed from this evidence record as an
executable command sequence. Any current incident must preserve remote state,
capture fresh readback, and enter through the future remote-write protocol admission boundary
in the current deployment-authority runbook. Historical approval must not be
reused.

## API Worker Rollback Rehearsal: 2026-07-09

Rehearsal type: non-mutating release-target dry-run, Cloudflare deployment
readback, then-live health checks, and decision record. No traffic-changing
rollback or redeploy was executed because the observed deployment was healthy
and the candidate previous Worker versions were not approved rollback targets.

Dry-run source:

- Commit: `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- Local worktree: `test/.tmp/rollback-release-target`
- Wrangler version: `4.107.0`
- Output directory: `test/.tmp/rollback-rehearsal`

Historical dry-run results (the command strings below are a non-executable
historical log of what ran in 2026-07, not instructions or current authority):

| Environment | Command                                                                                                 | Result | Bundle output                                |
| ----------- | ------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| staging     | `pnpm exec wrangler deploy --env staging --dry-run --outdir test/.tmp/rollback-rehearsal/staging`       | passed | `Total Upload: 188.61 KiB / gzip: 37.52 KiB` |
| production  | `pnpm exec wrangler deploy --env production --dry-run --outdir test/.tmp/rollback-rehearsal/production` | passed | `Total Upload: 188.61 KiB / gzip: 37.52 KiB` |

Cloudflare deployment readback:

| Environment | Deployment ID                          | Version ID                             | Traffic | Created                       |
| ----------- | -------------------------------------- | -------------------------------------- | ------- | ----------------------------- |
| staging     | `ae336be4-169b-4a8a-a8c7-8d4b8ab7fa32` | `bf0333dc-9efa-4001-aa31-20b3e10731c9` | `100%`  | `2026-07-08T01:42:32.992153Z` |
| production  | `24f81b98-b761-4faa-aa78-cd773bb5d0c1` | `72577dd9-c859-4673-b653-fbdd796f8f7d` | `100%`  | `2026-07-08T01:42:43.738247Z` |

Historical live-health observations:

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

Historical decision: `continue`. No actual rollback or redeploy was performed.
That decision expired with the rehearsal and must not be reused for a current
incident.

## Website Previous-Version Handle

Standing operator approval was provided on 2026-07-08. The website was first
deployed from `kazu-42/HonoWarden-website` after PR #1 passed CI and was
merged. Security contact metadata was then published after PR #2 passed CI and
Email Routing inbound smoke was verified.

- Website merge commit: `97095812384b47e5a1798108d77d8224f75509f2`
- Observed deployment: `1c3fc838-3e84-448a-ba36-a8181f3e6eed`
- Observed version: `b408a4e2-4279-4a57-8172-698b1c77c6ab`
- Deployment readback at `2026-07-09T14:22Z`: version received `100%` traffic
- Previous deployment: `0f398ae5-6d01-42a8-bbe4-35378661ce81`
- Previous version: `eef4ab71-d6e8-401f-93c3-27e7bd2bcd91`
- Previous status: known-good public website deployment before security
  metadata publication
- Historical rollback candidate: version
  `eef4ab71-d6e8-401f-93c3-27e7bd2bcd91`; the contemplated command has been
  removed so this record cannot be mistaken for current website authority
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
- `/.well-known/security.txt`: HTTP `200` on apex and `www`, with verified
  public contact and security policy links
- `/security.txt`: HTTP `308` on apex and `www`, redirecting to
  `/.well-known/security.txt`

## Email Routing Rollback Handle

Email Routing was enabled on 2026-07-09 after operator approval. Pre-change
readback from 2026-07-08 showed no MX records and no apex TXT records for
`honowarden.com`.

- `honowarden.com` nameservers: `anna.ns.cloudflare.com`,
  `damon.ns.cloudflare.com`
- Observed Email Routing state: `enabled: true`, API status `ready`
- Observed destination count: `1`, verified destination tag `e732fc786e52`
- Destination address value was intentionally not recorded
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

The identifiers above were retained only as historical rollback handles. The
2026-07 notes contemplated disabling the forwarding rules and Email Routing,
then removing residual MX/SPF records. That proposal was not executed and does
not authorize a current Email Routing or DNS mutation.

## Historical Evidence Fields

The 2026-07 evidence packet recorded or expected the following fields:

- approval text and timestamp
- operation owner
- environment
- commit SHA or configuration version before the operation
- commit SHA or configuration version after the operation
- previous Worker deployment id or route target
- previous website deployment id or route target
- previous DNS record state when DNS changed
- previous Email Routing rule state when email changed
- the contemplated rollback path
- health checks after rollback rehearsal or actual rollback
- decision to continue, rollback, or hold

Secret values, private forwarding destinations, and real vault data were not
recorded. No command template from the old packet is retained as an executable
recovery instruction.

## Not Performed

- Actual API Worker traffic-changing rollback or redeploy was not performed
  because live health checks passed.
- Website route rollback was not performed because post-deploy smoke passed.
- Email Routing rollback was not performed.
- DNS rollback was not performed.

## Completion Criteria

This historical evidence was marked `passed` because:

1. The relevant operations had standing operator approval.
2. Unsafe previous API Worker versions were rejected and an incident-specific
   release-target redeploy strategy was selected.
3. Worker, website, and Email Routing recovery handles were recorded for the
   2026-07 review; the obsolete command templates are no longer present.
4. Rehearsal health, route, and email-readback checks were recorded with a
   `continue` decision.
5. No secrets, private forwarding destinations, message bodies, or real vault
   data were included.

The historical `passed` result does not satisfy current recovery admission.
