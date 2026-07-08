# Email Routing Evidence

Target: `v0.1.0-alpha`.

Status: not_performed.

Mode: Cloudflare Email Routing setup and inbound smoke evidence.

This file is the required evidence placeholder for project email routing under
`honowarden.com`. It must remain `not_performed` until Email Routing is enabled,
destination inboxes are verified, routes are created, DNS records are checked,
and inbound test messages are received.

Do not store message bodies, attachments, private mailbox destinations, or
security-report content in this file. Evidence should use timestamps, route
names, message ids, and redacted delivery status only.

## Required Approval Before Execution

Email Routing approval must explicitly name:

- Cloudflare account and zone
- destination inboxes verified in Cloudflare
- recipient local parts to create
- whether DNS MX/SPF records may be changed
- rollback plan for route removal or provider switch

The current local preflight only checks inputs. It does not prove token scope,
destination verification, route creation, DNS readiness, or inbound delivery.

## Required Routes

Record route evidence for:

- `security@honowarden.com`
- `support@honowarden.com`
- `hello@honowarden.com`
- `admin@honowarden.com`
- `postmaster@honowarden.com`
- `abuse@honowarden.com`

The `security@` route should not be advertised as an active disclosure mailbox
until a destination verification and inbound test both pass.

## Evidence To Record After Configuration

Record these values after the approved configuration:

- approval text and timestamp
- Cloudflare account identity
- zone name
- Email Routing enabled state
- MX record state
- SPF record state
- destination verification state for each route
- route creation result for each local part
- inbound test timestamp for each route
- redacted delivery status for each route
- rollback route or previous provider state
- abort or rollback decision

## Local Preflight

```sh
pnpm email:preflight -- --strict
pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935
```

The preflight must not print tokens or forwarding destinations.

## Current Readback: 2026-07-08

Read-only checks were run after the website live evidence was recorded. No
Email Routing, DNS, destination, or route mutation was performed.

Local `direnv` state:

- `.envrc` is allowed for this repository.
- Ignored `.env.local` loads through `dotenv_if_exists`.
- `CLOUDFLARE_ACCOUNT_ID` is configured.
- `CLOUDFLARE_ZONE_ID_HONOWARDEN_COM` is configured.
- Six `HONOWARDEN_*_FORWARD_TO` route destination variables are configured.
- `CLOUDFLARE_API_TOKEN` is missing.

Local preflight:

- Command:
  `direnv exec . pnpm email:preflight -- --strict`
- Generated at: `2026-07-08T02:44:53.946Z`
- Result: `not_ready`
- Passing checks: Cloudflare account id, zone id, and all six route destination
  variables.
- Failing check: `cloudflare_api_token`
- No token or forwarding destination values were printed.

Operations readiness packet:

- Command:
  `direnv exec . pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- Generated at: `2026-07-08T02:54:53.763Z`
- Result: `not_ready`
- Email local preflight status: `not_ready`
- Configured routes: `6/6`
- Failed check: `cloudflare_api_token`
- Remaining local input blocker: `cloudflare_api_token_missing`

Wrangler and Cloudflare API readback:

- Wrangler version: `4.107.0`
- Auth mode: OAuth token for a redacted operator account
- Cloudflare account: `gHive`
- Cloudflare account ID: `7e31a4cfe4ffd2cfff49c04236261de8`
- Missing OAuth scopes reported by Wrangler include `email_routing:write` and
  `email_sending:write`.
- `direnv exec . pnpm exec wrangler email routing list` returned:
  `No zones found with Email Routing in this account.`
- `direnv exec . pnpm exec wrangler email routing settings honowarden.com`
  failed against
  `/zones/f943f9ad49c08ef28fe641cf9277b1ed/email/routing` with Cloudflare API
  authentication error `10000`.
- `direnv exec . pnpm exec wrangler email routing rules list honowarden.com`
  failed against
  `/zones/f943f9ad49c08ef28fe641cf9277b1ed/email/routing/rules` with
  Cloudflare API authentication error `10000`.
- `direnv exec . pnpm exec wrangler email routing addresses list` failed
  against
  `/accounts/7e31a4cfe4ffd2cfff49c04236261de8/email/routing/addresses` with
  Cloudflare API authentication error `10000`.
- Membership readback still reported `Super Administrator - All Privileges`;
  the failure is therefore treated as token/scope capability, not project
  documentation readiness.

DNS readback:

- Nameservers: `anna.ns.cloudflare.com`, `damon.ns.cloudflare.com`
- Apex A records: Cloudflare IPs returned.
- Apex AAAA records: Cloudflare IPs returned.
- `www` A records: Cloudflare IPs returned.
- `honowarden.com` MX records: none returned.
- Apex TXT records: none returned.

The next strict-readiness step is to provide a scoped `CLOUDFLARE_API_TOKEN`.
For manual Wrangler readback, refreshing Wrangler OAuth with Email Routing
scopes may also unblock the API reads. After the API is readable, verify the
destination address before creating routes.

## Not Performed

- Email Routing has not been enabled by this evidence file.
- DNS MX/SPF mutation has not been performed by this evidence file.
- Destination inbox verification has not been performed by this evidence file.
- Inbound email smoke has not been performed by this evidence file.
- No message body or attachment has been stored by this evidence file.

## Rollback

If route creation or inbound delivery fails:

1. Disable the failed route or restore the previous DNS/provider state.
2. Keep `security@honowarden.com` unadvertised until delivery is confirmed.
3. Record the route or DNS state after rollback.
4. Do not retry with real vulnerability-report content.
