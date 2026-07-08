# Week 26 Email Routing Readback

## Goal

Record the current Email Routing and DNS readback for `honowarden.com`, fix the
local direnv loader so ignored dotenv inputs are exported, and keep the next
operations blocker precise.

## Success Criteria

- `.env.local` dotenv-style inputs load through direnv into child processes.
- `pnpm email:preflight -- --strict` reports six configured route destinations
  and only the missing Cloudflare API token as the local blocker.
- Wrangler Email Routing readback is recorded without changing Cloudflare.
- DNS MX/TXT readback is recorded.
- `pnpm ops:readiness:packet` exposes the precise email blocker.
- Release evidence remains `not_performed` for live Email Routing until routes
  and inbound delivery are actually verified.

## Current Context

- The GitHub release, API Worker smoke, and website live evidence are recorded.
- Email Routing has not been enabled or advertised.
- Wrangler OAuth can access the `gHive` account but lacks Email Routing scopes.
- `.env.local` existed only as an intended ignored input source; the previous
  `.envrc` used shell sourcing for dotenv syntax, so values were not exported.

## Constraints

- Do not print token values.
- Do not print private forwarding destinations in main-repo evidence.
- Do not create DNS records, Email Routing destinations, or routing rules.
- Keep `security@honowarden.com` unadvertised as an active intake address.

## Risks

- Treating configured local destinations as live delivery proof would be wrong.
- An OAuth account can be a super administrator while still lacking required
  token scopes for a specific API surface.
- DNS absence and API authentication failure must be recorded separately.

## Approval Required

No approval required for local ignored env setup, read-only Cloudflare/DNS
readback, tests, docs, and evidence updates. Future DNS, Email Routing, or
destination writes still require an authenticated token/session and rollback
evidence.

## Work Packets

- Direnv packet: make `.env.local` load with `dotenv_if_exists`.
- Readback packet: run Wrangler and DNS read-only checks.
- Ops packet: make readiness output identify the precise missing email input.
- Evidence packet: update release/current-state docs and workflow artifact.
- Verification packet: run focused and broad repository checks.

## Integration Policy

Accept only redacted, reproducible evidence. Keep live-routing status as
`not_performed` until a successful route configuration and inbound smoke are
recorded.

## Verification

- `direnv exec . pnpm email:preflight -- --strict`
- `direnv exec . pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- focused Vitest suites for operator env, email preflight, ops readiness, and
  release docs
- repository typecheck, lint, brand scan, format check, release gate, and
  workflow verification

## Reusable Artifacts

Use this workflow as the template for future external-service readbacks:
separate local input readiness, provider auth/scope readback, DNS state, route
or resource mutation, rollback handle, and inbound/live proof.
