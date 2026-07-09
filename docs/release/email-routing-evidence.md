# Email Routing Evidence

Target: `v0.1.0-alpha`.

Status: passed.

Mode: Cloudflare Email Routing setup and inbound smoke evidence.

This file is the required evidence placeholder for project email routing under
`honowarden.com`. It must remain `partial` until Email Routing is enabled,
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

## Current Readback: 2026-07-09

Approved Cloudflare Email Routing setup was performed with local-only global
API key auth. The key is stored outside the repository under the operator's
home configuration, loaded through ignored direnv files, and is not recorded in
git or this evidence.

Approval context:

- Operator approved using the prepared global API key for the gHive account on
  2026-07-09 JST.
- Operator approved routing and database changes, a new repository if needed,
  and retention policy work in the same thread.
- No secrets, token values, private destination addresses, message bodies, or
  attachments were recorded.

Cloudflare account and zone:

- Cloudflare account: `gHive`
- Cloudflare account ID: `7e31a4cfe4ffd2cfff49c04236261de8`
- Zone: `honowarden.com`
- Zone ID: `f943f9ad49c08ef28fe641cf9277b1ed`

Email Routing settings:

- API readback: `enabled: true`
- API status: `ready`
- Previous catch-all/drop rule remains disabled and unchanged.

Destination readback:

- Configured destination count: `1`
- Destination hash tag: `e732fc786e52`
- Destination verified: `true`
- Destination created and modified:
  `2026-07-09T12:31:29.945652Z`
- Destination address value is intentionally not recorded.

DNS readback:

| Type | Record ID                          | Content                                        | Priority |
| ---- | ---------------------------------- | ---------------------------------------------- | -------- |
| MX   | `04fa6f6528ab56d9d2b3d6fbd8fa9ded` | `route3.mx.cloudflare.net`                     | `28`     |
| MX   | `62a4125f5191bf644e1723cceb04839f` | `route2.mx.cloudflare.net`                     | `35`     |
| MX   | `d1df42e54f0d39facf12ff0e4a6f0668` | `route1.mx.cloudflare.net`                     | `63`     |
| TXT  | `905639146eeaf7449af796d7bef2a8ab` | `"v=spf1 include:_spf.mx.cloudflare.net ~all"` | n/a      |

Public DNS readback also returned the Cloudflare MX records and SPF TXT record
for `honowarden.com`.

Route readback:

| Address                     | Rule ID                            | Priority | Enabled | Action    |
| --------------------------- | ---------------------------------- | -------- | ------- | --------- |
| `security@honowarden.com`   | `c303ee9d52e94355a6a5c0680163927c` | `0`      | `true`  | `forward` |
| `support@honowarden.com`    | `f9821e487f1d4e6e989f0fca1fb5ea6b` | `1`      | `true`  | `forward` |
| `hello@honowarden.com`      | `e9d2b80c19cf47038165b15282c68eb4` | `2`      | `true`  | `forward` |
| `admin@honowarden.com`      | `0d3aea1c4e13401085cf7c6be2b7ac00` | `3`      | `true`  | `forward` |
| `postmaster@honowarden.com` | `f44abae45fc749f9a99e8945ad46e994` | `4`      | `true`  | `forward` |
| `abuse@honowarden.com`      | `b9d2bf82f1bc41f688299e8be617c7dd` | `5`      | `true`  | `forward` |

Local preflight:

- Command: `direnv exec . pnpm email:preflight -- --strict`
- Result: `ready`
- Auth path: Cloudflare global API key plus operator email.
- Configured routes: `6/6`
- No token, global key, operator email, or forwarding destination value was
  printed.

Inbound smoke:

- Status: `passed`
- Send attempt reported by operator at `2026-07-09 22:40 JST`.
- Sender: redacted external mailbox on the `ghive.jp` domain.
- Subject: `テスト`
- Body: empty
- Reported recipients: all six required routes:
  `security`, `support`, `hello`, `admin`, `postmaster`, and `abuse`.
- Cloudflare route readback after the send attempt still reported
  `enabled: true`, status `ready`, six enabled forwarding rules, and one
  verified destination tag.
- Cloudflare Email Routing activity log readback for
  `2026-07-09T13:40:21Z` through `2026-07-09T13:40:22Z` returned six events:
  one for each required route.
- Cloudflare status for all six activity events: `delivered`.
- Cloudflare action for all six activity events: `forward`.
- Message ID hash tag for the shared test message: `3d0d15372730`.
- Sender hash tag for the redacted external mailbox: `9c725de34b0e`.
- SPF/DKIM/DMARC readback: `spf: pass`, `dkim: pass`, `dmarc: none`.
- Spam readback: `isSpam: 0`, `spamScore: 1`.
- Error readback: empty `errorDetail`.
- Operator confirmed that the forwarded test mail was visible in the verified
  destination inbox at `2026-07-09 22:59 JST`.
- Mailbox visibility was confirmed without recording message bodies, mailbox
  contents, or the private destination address.
- `security@honowarden.com` may now be referenced by future security metadata
  work, but real vulnerability-report handling still depends on the separate
  retention and redaction controls tracked for the inquiry inbox.

## Previous Readback: 2026-07-08

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

At that time, the next strict-readiness step was to provide Cloudflare API auth
that could read and write Email Routing. That blocker was resolved on
2026-07-09 by loading local-only global API key auth outside the repository.

## Not Performed

- Security contact metadata has not been published from this evidence file.
- No message body, attachment, private forwarding destination, operator email,
  token, or global key value has been stored by this evidence file.

## Rollback

If route creation or inbound delivery fails:

1. Disable the failed route or restore the previous DNS/provider state.
2. Keep `security@honowarden.com` unadvertised until delivery is confirmed.
3. Record the route or DNS state after rollback.
4. Do not retry with real vulnerability-report content.
