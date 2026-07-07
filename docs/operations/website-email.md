# Website And Email Operations

This document organizes the public website and email work around
`honowarden.com`.

## Known URLs And Repositories

- API repository: `https://github.com/kazu-42/HonoWarden`
- Website repository: `https://github.com/kazu-42/HonoWarden-website`
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
7. Configure email routing for project contact addresses after Cloudflare Email
   Routing scopes are available.
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

## Email Worker Phases

Phase 1 should use simple Email Routing forwarding rules only.

Phase 2 can add an Email Worker when there is a concrete need:

- reject oversized messages
- reject obvious malformed or abusive senders
- route by recipient address
- add a rate-limited acknowledgment for `security@`
- archive non-sensitive metadata in R2 for operational evidence

Do not parse or store full message bodies or attachments in HonoWarden systems
until retention, access control, and deletion policy are written down.

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

## Current Status

Website:

- `HonoWarden-website` exists as a public GitHub repository.
- `honowarden.com` and `www.honowarden.com` currently return the Hono Worker
  website over HTTPS.
- `/health` currently returns the website health JSON response.

Email:

- Cloudflare Email Routing is not yet enabled for `honowarden.com`.
- The current Wrangler OAuth session can manage Workers but is missing
  `email_routing:write`.
- `security@honowarden.com` should not be advertised as an active disclosure
  mailbox until the destination address is verified and an inbound test succeeds.

## Rollback

Website rollback:

- redeploy the previous website Worker version, or
- remove the custom route and fall back to the previous DNS target.

Email rollback:

- disable the new route rule or Email Worker binding.
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
- public security contact verification
