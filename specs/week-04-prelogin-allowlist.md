# Spec: Week 04 Prelogin Allowlist

## Summary

Week 04 introduces the first client-facing identity endpoint: password prelogin KDF discovery. It is allowlist-gated and default-deny. This increment does not create accounts, verify passwords, or issue tokens.

## Inputs

- `POST /identity/accounts/prelogin`
- JSON body with `email`
- `HONOWARDEN_ALLOWED_EMAILS`: comma or whitespace separated email allowlist

## Outputs

- Allowed email:
  - HTTP `200`
  - JSON body includes `kdf`, `kdfIterations`, `kdfMemory`, and `kdfParallelism`
- Missing or malformed email:
  - HTTP `400`
  - JSON error code `invalid_request`
- Email outside the allowlist:
  - HTTP `403`
  - JSON error code `prelogin_not_allowed`
- Public registration endpoints:
  - HTTP `403`
  - JSON error code `registration_disabled`

## Behavior

1. Email input is trimmed and lowercased before allowlist comparison.
2. The allowlist defaults to empty, so prelogin is denied until configured.
3. The endpoint returns stable KDF parameters for allowed emails.
4. Rejected requests do not expose SQL errors, user records, or secret material.
5. Public account registration stays disabled.

## Edge Cases

- Invalid JSON is treated as a malformed request.
- Blank, missing, or obviously invalid email values are rejected.
- Allowlist entries may be separated by commas or whitespace.

## Acceptance Criteria

- [x] Domain tests cover email normalization, allowlist parsing, default deny, and invalid request handling.
- [x] `POST /identity/accounts/prelogin` returns KDF parameters for allowed email addresses.
- [x] `POST /identity/accounts/prelogin` returns `403` outside the allowlist.
- [x] Public registration endpoints return `403`.
- [x] `pnpm cf:typegen` reflects the new environment variable.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
