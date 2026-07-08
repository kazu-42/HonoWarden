# Orchestration: Week 26 Email Routing Readback

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If `.env.local` loads but variables are missing from child processes, inspect
  `.envrc` loader semantics before changing the preflight script.
- If Email Routing API calls fail with Cloudflare authentication error `10000`,
  record token/scope state and stop before any write attempt.
- If DNS MX/TXT records are absent, record that as pre-change DNS state, not as
  a failed mutation.
- If local destinations are configured, record only configured/missing status in
  main-repo evidence.

## Packet Prompts

- Direnv packet: make ignored dotenv inputs export correctly without committing
  values.
- Readback packet: collect Wrangler account/scope, Email Routing API, and DNS
  readback.
- Ops packet: ensure readiness JSON names the precise email blocker.
- Evidence packet: update docs and tests so release status remains honest.

## Completion Audit

- No Cloudflare writes were performed.
- No email was sent.
- No token or private destination value was added to tracked files.
- Email Routing evidence still says `Status: not_performed`.
- The remaining local input blocker is `cloudflare_api_token`.
