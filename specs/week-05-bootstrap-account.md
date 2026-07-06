# Spec: Week 05 Bootstrap Account

## Summary

Week 05 introduces a private operator bootstrap endpoint for creating the first account. This is not public registration. Bootstrap is default-off, token-protected, allowlist-gated, and relies on the D1 unique email constraint to prevent duplicate parallel creation.

## Inputs

- `POST /api/accounts/bootstrap`
- `HONOWARDEN_BOOTSTRAP_ENABLED`
- `HONOWARDEN_BOOTSTRAP_TOKEN`
- `HONOWARDEN_ALLOWED_EMAILS`
- JSON body:
  - `email`
  - `masterPasswordHash`
  - optional `displayName`
  - optional encrypted key fields

## Outputs

- Disabled bootstrap:
  - HTTP `403`
  - JSON error code `bootstrap_disabled`
- Missing or invalid bootstrap token:
  - HTTP `403`
  - JSON error code `bootstrap_forbidden`
- Invalid payload:
  - HTTP `400`
  - JSON error code `invalid_request`
- Email outside allowlist:
  - HTTP `403`
  - JSON error code `bootstrap_not_allowed`
- Created account:
  - HTTP `201`
  - JSON body with `object`, `id`, and normalized `email`
- Duplicate account:
  - HTTP `409`
  - JSON error code `account_exists`

## Behavior

1. Bootstrap is disabled unless `HONOWARDEN_BOOTSTRAP_ENABLED` is explicitly true-like.
2. Bootstrap requires `X-HonoWarden-Bootstrap-Token` to match `HONOWARDEN_BOOTSTRAP_TOKEN`.
3. Email input is normalized before allowlist and unique-key comparison.
4. The server stores the submitted password hash and encrypted key material, never a plaintext password.
5. The D1 insert uses `INSERT OR IGNORE` against the unique `email_normalized` column, so concurrent duplicate bootstraps cannot create two accounts.
6. Public registration endpoints remain disabled.

## Edge Cases

- Missing token and wrong token are both forbidden.
- Missing email or missing password hash is invalid.
- Duplicate insert returns a stable conflict response.
- D1 failures return a stable unavailable response without raw SQL details.

## Acceptance Criteria

- [x] Domain tests cover enable flag, token comparison, allowlist validation, and record construction.
- [x] Repository tests cover created and duplicate D1 insert results.
- [x] HTTP tests cover disabled, forbidden, created, and duplicate responses.
- [x] `pnpm cf:typegen` reflects bootstrap enablement config.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
