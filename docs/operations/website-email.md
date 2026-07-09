# Website And Email Operations

This document organizes the public website and email work around
`honowarden.com`.

## Known URLs And Repositories

- API repository: `https://github.com/kazu-42/HonoWarden`
- Website repository: `https://github.com/kazu-42/HonoWarden-website`
- Inquiry inbox repository:
  `https://github.com/kazu-42/HonoWarden-inquiry-inbox`
- Linear workspace: `https://linear.app/honowarden/`
- Public domain: `honowarden.com`

## Recommended Order

1. Prepare local operator env with direnv.
2. Confirm GitHub and Cloudflare identity with read-only commands.
3. Keep `kazu-42/HonoWarden-website` as the separate public website
   repository.
4. Keep the Hono Worker website deployable from that separate repository.
5. Keep CI, typecheck, lint, tests, and formatting green in the website
   repository.
6. Verify `honowarden.com` and `www.honowarden.com` after each website deploy.
7. Configure email routing for project contact addresses after Cloudflare API
   write access and destination verification are available.
8. Record DNS, email, deployment, and rollback evidence in this repository and
   the website repository.
9. Mirror completed work into Linear issues and project updates once the Linear
   API key is available.

## Website Shape

The first website should be a real project page, not a placeholder shell.

Required first release content:

- project name and concise scope
- alpha status and explicit limitation that this is personal/small-team vault
  sync infrastructure
- links to GitHub, release notes, security policy, and operational docs
- security contact address
- no public registration call-to-action
- no claims about unsupported clients or organization features

Recommended deployment:

- separate Hono Worker repository: `HonoWarden-website`
- Worker route: `honowarden.com/*`
- optional redirect or route: `www.honowarden.com/*`
- Cloudflare observability enabled
- no D1/R2 binding in the initial website unless a concrete feature requires it

## Email Decision

Cloudflare Email Routing is forwarding and processing infrastructure, not a
mailbox. It can receive mail for `honowarden.com` and forward it to verified
destinations, but it does not provide an inbox UI or long-term mailbox storage.

Recommended alpha setup:

| Address                     | Purpose                            | Initial handling                                                     |
| --------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `security@honowarden.com`   | vulnerability reports              | Forward to verified private destination; no auto-reply until tested. |
| `support@honowarden.com`    | operational support                | Forward to verified private destination.                             |
| `hello@honowarden.com`      | general project contact            | Forward to verified private destination.                             |
| `admin@honowarden.com`      | domain and service operations      | Forward to verified private destination.                             |
| `postmaster@honowarden.com` | required domain operations contact | Forward to verified private destination.                             |
| `abuse@honowarden.com`      | required abuse contact             | Forward to verified private destination.                             |

If a real mailbox UI is required, choose a mailbox provider separately and
configure that provider's MX, SPF, DKIM, and DMARC records instead of or
alongside Cloudflare Email Routing. Do not assume Cloudflare Email Routing alone
is a mail client.

For the project-owned AI inquiry inbox path, use
[AI Inquiry Inbox Architecture](ai-inquiry-inbox.md). That design keeps the
alpha forwarding posture until route evidence, access control, retention,
redaction, and human approval rules are in place.

## Email Worker Phases

Phase 1 should use simple Email Routing forwarding rules only.

Phase 2 can add an Email Worker when there is a concrete need:

- reject oversized messages
- reject obvious malformed or abusive senders
- route by recipient address
- add a rate-limited acknowledgment for `security@`
- archive non-sensitive metadata in D1 for operational evidence

Do not parse or store full message bodies or attachments in HonoWarden systems
until retention, access control, and deletion policy are written down.

Phase 3 can add the AI inquiry inbox after the architecture gate is satisfied:

- metadata-only ingestion and forwarding remain the default
- raw MIME and attachment storage require an explicit retention/deletion switch
- AI may classify, summarize, and draft, but external replies require human
  approval by default
- Linear issue creation uses redacted summaries and requires human approval

## Cloudflare Configuration Checklist

Website:

- `honowarden.com` zone exists in the intended Cloudflare account.
- Worker or Pages deployment exists for the website repository.
- Route `honowarden.com/*` points to the website.
- Route or redirect for `www.honowarden.com/*` is defined.
- Rollback route or previous deployment id is recorded.

Email:

- Email Routing is enabled for `honowarden.com`.
- MX and SPF records are present as Cloudflare expects.
- Destination inboxes are verified.
- Routes exist for `security`, `support`, `hello`, `admin`, `postmaster`, and
  `abuse`.
- A test message is sent to each route and received at the destination.
- Evidence records message ids or timestamps without message content.

Local preflight:

```sh
pnpm email:preflight
pnpm email:preflight -- --strict
pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935
```

`pnpm ops:readiness:packet` may also be run without the tag workflow arguments
after `.workflow/week-26-release-tag-recovery/state.json` records the passed
`Release Tag Verification` run; the packet revalidates that run before using it.

The preflight is offline. It checks whether Cloudflare API auth,
account/zone inputs, and forwarding-destination variables are present, but it
does not call Cloudflare, create routes, send messages, or print token,
global-key, operator-email, or destination values.

The operations readiness packet is also read-only. It combines the alpha release
completion audit, local email preflight, and recorded evidence files so deploy,
DNS, website, email, smoke-test, and rollback approvals remain separate from
GitHub Release publication.

The evidence files are:

- `docs/release/website-live-evidence.md`
- `docs/release/email-routing-evidence.md`
- `docs/release/ops-rollback-evidence.md`

They intentionally start as `Status: not_performed` or `Status: partial`; do
not mark them `passed` until the approved operation, redacted smoke evidence,
and rollback handle are recorded.

## Current Status

Website:

- `HonoWarden-website` exists as a public GitHub repository.
- `honowarden.com` and `www.honowarden.com` currently return the Hono Worker
  website over HTTPS.
- `/health` currently returns the website health JSON response.

Email:

- Cloudflare Email Routing is enabled for `honowarden.com`.
- Cloudflare-managed MX records and SPF TXT are present for the apex domain.
- Forwarding routes exist for `security`, `support`, `hello`, `admin`,
  `postmaster`, and `abuse`.
- The configured destination count is `1` and the destination is verified in
  Cloudflare.
- Inbound smoke has passed for all required routes, with Cloudflare activity
  logs showing delivered forwarding events and operator-confirmed mailbox
  visibility.
- `security@honowarden.com` is now referenced by the public website and
  `security.txt`, but real vulnerability-report handling still depends on the
  inquiry inbox retention and redaction controls.
- `HonoWarden-inquiry-inbox` exists as a separate public GitHub repository for
  the HON-24 metadata-only inbound storage slice.
- The inquiry inbox has separate staging and production Workers, D1 databases,
  and R2 buckets from the vault API Worker.
- The inquiry inbox production Worker is deployed as
  `honowarden-inquiry-inbox`, and its D1 database is `honowarden-inquiry`.
- The hidden smoke route `inquiry-smoke@honowarden.com` points to the inquiry
  Worker for live Email Routing verification.
- Public routes for `security`, `support`, `hello`, `admin`, `postmaster`, and
  `abuse` remain forwarding-only; do not switch them to the Worker until hidden
  smoke evidence and a reversible route migration are recorded.
- HON-24 stores inbound metadata and audit events only. Raw MIME and attachment
  object writes remain disabled, and attachment-bearing messages are rejected.

## Rollback

Website rollback:

- redeploy the previous website Worker version, or
- remove the custom route and fall back to the previous DNS target.

Email rollback:

- disable the hidden Worker route or switch any migrated public route back to
  forwarding-only.
- keep MX records unchanged if Email Routing remains the intended receiver.
- if switching to a mailbox provider, apply the provider's MX records only after
  verifying DNS propagation and inbound delivery.

## Linear Work Items To Track

Create or update issues for:

- website repository creation
- website first page implementation
- website deployment and domain route evidence
- Email Routing destination verification
- email route smoke evidence
- mailbox-provider decision, if a real inbox UI is required
- AI inquiry inbox implementation phases after the architecture gate
- public security contact verification
