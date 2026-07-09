# Operations Rollback Evidence

Target: `v0.1.0-alpha`.

Status: partial.

Mode: post-alpha rollback handle and recovery evidence.

This file records rollback readiness after Worker deploy, website route changes,
or Email Routing changes. It remains `partial` until API Worker rollback target
selection and a rollback rehearsal or actual rollback have been verified.

Rollback readiness is separate from release publication, CI success, and local
dry-run output.

## API Worker Previous-Version Handles

Standing operator approval was provided on 2026-07-08. API Worker deploys were
completed after the alpha GitHub Release was published and verified.

### Staging API Worker

- Current version: `bf0333dc-9efa-4001-aa31-20b3e10731c9`
- Current deployment: `ae336be4-169b-4a8a-a8c7-8d4b8ab7fa32`
- Candidate previous version: `f2357f14-8430-4b9f-913d-2dbad72322dd`
- Candidate status: pre-correction `main` deployment, not verified as the safe
  rollback target
- Approved rollback command: unresolved

### Production API Worker

- Current version: `72577dd9-c859-4673-b653-fbdd796f8f7d`
- Current deployment: `24f81b98-b761-4faa-aa78-cd773bb5d0c1`
- Candidate previous version: `2c0b365b-3cf9-4766-ba8d-e5bd969c969d`
- Candidate status: pre-correction `main` deployment, not verified as the safe
  rollback target
- Approved rollback command: unresolved

The candidate previous versions are known deployable Worker versions, but they
are the pre-correction deployments from `main`
`392637b3e277ba35057ba461cd82fac69013f603`, not the alpha release target. Do
not treat them as approved rollback targets without an incident-specific
decision. Rollback was not executed because post-deploy smoke passed.

## Website Previous-Version Handle

Standing operator approval was provided on 2026-07-08. The website deployment
was performed from `kazu-42/HonoWarden-website` after PR #1 passed CI and was
merged.

- Website merge commit: `36b8171f7afd55bf306e5482cca454a0b3822a39`
- Current deployment: `0f398ae5-6d01-42a8-bbe4-35378661ce81`
- Current version: `eef4ab71-d6e8-401f-93c3-27e7bd2bcd91`
- Previous deployment: `5b1f701c-4654-46e5-bca7-09de61316783`
- Previous version: `3db432cb-6422-4311-b558-6eb2b0b5bb51`
- Previous status: known-good public website deployment that did not advertise
  an active unverified security mailbox
- Rollback command:
  `pnpm exec wrangler rollback 3db432cb-6422-4311-b558-6eb2b0b5bb51 --name honowarden-website --yes`
- Rollback execution: not performed because post-deploy website smoke passed

## Email Routing Rollback Handle

Email Routing was enabled on 2026-07-09 after operator approval. Pre-change
readback from 2026-07-08 showed no MX records and no apex TXT records for
`honowarden.com`.

- `honowarden.com` nameservers: `anna.ns.cloudflare.com`,
  `damon.ns.cloudflare.com`
- Current Email Routing state: `enabled: true`, API status `ready`
- Current destination count: `1`, verified destination tag `e732fc786e52`
- Destination address value is intentionally not recorded
- Inbound smoke status: `not_performed`
- Rollback execution: not performed because route/DNS readback passed and
  inbound smoke is still pending

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
# API Worker rollback command is unresolved.
# Candidate previous versions for investigation:
# staging: f2357f14-8430-4b9f-913d-2dbad72322dd
# production: 2c0b365b-3cf9-4766-ba8d-e5bd969c969d
#
# Do not run a rollback until the operator selects a verified safe target or
# decides to redeploy a reviewed commit.
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

- API Worker rollback command approval has not been recorded.
- API Worker rollback rehearsal has not been performed by this evidence file.
- Website route rollback has not been performed by this evidence file because
  post-deploy smoke passed.
- Email Routing rollback has not been performed by this evidence file.
- DNS rollback has not been performed by this evidence file.

## Completion Criteria

This evidence can be marked `passed` only after:

1. The relevant operation has approval.
2. The previous safe state is identified.
3. A concrete rollback command or dashboard path is recorded.
4. Post-rollback health or route checks are recorded.
5. No secrets or private message content are included.
