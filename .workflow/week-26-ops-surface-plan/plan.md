# Week 26 Ops Surface Plan

## Goal

Organize the remaining Week 26 operational surface around local operator
environment, Linear API access, website publication, and email handling for
`honowarden.com`.

## Success Criteria

- direnv has a committed non-secret `.envrc`.
- `.env.example` lists the secrets and operational inputs needed for Linear,
  GitHub, Cloudflare, website publication, and email routing.
- Documentation explains which URLs are known and which inputs are still needed.
- Website publication and email handling are split into safe phases.
- External writes remain gated behind explicit approval and validated
  credentials.
- Local docs are linked from README and pass formatting/tests.

## Current Context

- API repository: `https://github.com/kazu-42/HonoWarden`
- Website repository to create: `https://github.com/kazu-42/HonoWarden-website`
- Linear workspace URL: `https://linear.app/honowarden/`
- Domain: `honowarden.com`
- Existing Linear seed: `ops/linear/honowarden.seed.json`
- Existing Cloudflare Worker config: `wrangler.jsonc`

## Constraints

- Do not commit API keys, destination inboxes, tokens, or runtime secrets.
- Do not perform Cloudflare, GitHub, Linear, DNS, email, or deploy writes without
  explicit operator approval.
- Keep external brand strings out of implementation identifiers and paths.
- Keep HonoWarden API repo and website repo separate.

## Risks

- Linear API key could target the wrong workspace.
- Cloudflare token could have excessive scope or point to the wrong account.
- Email Routing is not a mailbox; a separate mailbox provider may be needed.
- DNS/email changes can interrupt delivery if MX/SPF/DKIM/DMARC are wrong.

## Approval Required

No approval is required for local docs and non-secret env scaffolding. Approval
is required before creating repos, applying Linear seed data, changing
Cloudflare DNS/email, setting Wrangler secrets, deploying, or sending email.

## Work Packets

1. Operator environment: add direnv defaults and ignored secret template.
2. Ops documentation: document required keys, URLs, and validation checklist.
3. Website/email plan: define publication, email routing, mailbox, and rollback
   decisions.
4. Verification: format, tests that cover docs/scripts, brand scans, commit,
   push, CI.

## Integration Policy

Prefer local docs and templates over external state changes. Treat any missing
credential as an input to request, not as a blocker for local planning.

## Verification

- `pnpm linear:seed`
- docs-related tests
- `pnpm format`
- repository brand content/path scans
- GitHub Actions after push

## Reusable Artifacts

- `.envrc`
- `.env.example`
- `docs/operations/operator-environment.md`
- `docs/operations/website-email.md`
