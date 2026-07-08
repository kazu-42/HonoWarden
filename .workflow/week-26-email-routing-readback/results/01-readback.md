# Result 01: Readback

## Accepted

- `.envrc` now uses `dotenv_if_exists .env.local`.
- `direnv allow` succeeded after the `.envrc` change.
- `direnv exec . pnpm email:preflight -- --strict` reported `not_ready`
  because `cloudflare_api_token` is missing.
- The same preflight reported Cloudflare account id, zone id, and six route
  destination variables as configured.
- Wrangler `whoami` readback confirmed OAuth access to the `gHive` account; the
  operator email is intentionally redacted from tracked evidence.
- Wrangler reported missing `email_routing:write` and `email_sending:write`.
- Email Routing settings, rules, and destination-address API readbacks failed
  with Cloudflare authentication error `10000`.
- DNS readback showed Cloudflare nameservers and no MX/TXT records.

## Rejected

- No DNS mutation.
- No Email Routing destination verification.
- No route creation.
- No inbound test message.
- No evidence status promotion.
