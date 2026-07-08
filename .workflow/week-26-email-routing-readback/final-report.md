# Final Report: Week 26 Email Routing Readback

## Outcome

Recorded the current Email Routing blocker and fixed local direnv loading for
ignored dotenv inputs.

## Accepted Results

- `.envrc` now uses `dotenv_if_exists .env.local`.
- Ignored `.env.local` is present locally with non-secret account/zone values
  and route destination variables.
- `direnv exec . pnpm email:preflight -- --strict` now reports account id, zone
  id, and all six destination variables configured.
- The remaining local preflight blocker is `CLOUDFLARE_API_TOKEN`.
- Wrangler readback confirms OAuth access to account `gHive` /
  `7e31a4cfe4ffd2cfff49c04236261de8`; the operator email is intentionally
  redacted from tracked evidence.
- Wrangler reports missing `email_routing:write` and `email_sending:write`.
- Email Routing settings, rules, and destination-address readbacks fail with
  Cloudflare API authentication error `10000`.
- DNS readback shows Cloudflare nameservers and website A/AAAA records, but no
  MX or apex TXT records.
- Ops readiness output now includes failed email preflight check IDs.

## Rejected Results

- Did not enable Email Routing.
- Did not add MX/SPF records.
- Did not create or verify destination addresses.
- Did not create routes.
- Did not send inbound test email.
- Did not mark Email Routing evidence as passed.

## Conflicts Resolved

The previous `.envrc` treated `.env.local` as a shell script. That conflicted
with `.env.example` and docs that define dotenv-style `KEY=value` entries. The
loader now matches the documented file format.

## Verification Evidence

- `direnv exec . pnpm email:preflight -- --strict`
- `direnv exec . pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- `direnv exec . pnpm exec wrangler whoami`
- `direnv exec . pnpm exec wrangler email routing list`
- `direnv exec . pnpm exec wrangler email routing settings honowarden.com`
- `direnv exec . pnpm exec wrangler email routing rules list honowarden.com`
- `direnv exec . pnpm exec wrangler email routing addresses list`
- `dig +short NS/A/AAAA/MX/TXT honowarden.com`

## Remaining Risks

- A scoped `CLOUDFLARE_API_TOKEN` or refreshed Wrangler OAuth is still required
  before Email Routing can be configured.
- Destination verification in Cloudflare has not been proven.
- MX/SPF records are not present.
- Inbound delivery has not been tested.
- `security@honowarden.com` must remain unadvertised as an active intake
  mailbox.

## Reusable Follow-up

After a token/session with Email Routing access is available, run strict local
preflight, read settings/rules/addresses, enable routing if needed, verify the
destination address, create routes, record MX/SPF state, send redacted inbound
smoke messages, and only then mark Email Routing evidence `passed`.
