# Packet 02 Result: Staging Migrations

The first migration command omitted `--remote`, so Wrangler applied it only to
local state. That run is explicitly excluded from release evidence.

Reran with `--remote`:

```sh
printf 'y\n' | pnpm wrangler d1 migrations apply honowarden-staging --env staging --remote
```

Remote staging D1 then reported `schema_migrations` versions:

- `0001`
- `0002`
- `0003`

Remote table verification included the required alpha tables for users, devices,
refresh tokens, folders, ciphers, login defenses, and TOTP state.
