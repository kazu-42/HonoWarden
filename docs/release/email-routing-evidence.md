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
