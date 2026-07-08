# Packet 01: Direnv And Email Readback

## Objective

Make ignored local dotenv inputs usable by child processes and record the
read-only Email Routing state.

## Scope

- `.envrc`
- `.env.local` ignored local file
- `pnpm email:preflight`
- Wrangler Email Routing readback commands
- DNS `dig` readback

## Constraints

- Do not commit `.env.local`.
- Do not print token values.
- Do not store private destination values in tracked evidence.
- Do not mutate Cloudflare DNS or Email Routing.

## Expected Output

- Local inputs export correctly under `direnv exec .`.
- Email preflight has exactly one remaining failed check:
  `cloudflare_api_token`.
- Cloudflare Email Routing API readback failure is recorded as authentication
  error `10000`.
- DNS pre-change state is recorded.
