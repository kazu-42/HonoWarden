# Week 8 Empty Vault Sync

## Goal

Implement authenticated empty vault sync through `GET /api/sync`.

## Success Criteria

- Access tokens are verified by signature and expiration.
- Missing or invalid tokens are rejected.
- Authenticated users receive a fixture-compatible empty sync response.
- Disabled users cannot sync.
- Full checks and CI pass.

## Current Context

- Week 7 refresh rotation is pushed and CI-green.
- Password and refresh grants issue HMAC-signed access tokens.
- Empty sync compatibility fixture already exists.

## Constraints

- Do not implement folder/cipher CRUD in this slice.
- Do not log or return plaintext vault data.
- Keep upstream-provider brand strings out of tracked files.
- Do not set real secrets or deploy.

## Risks

- Access token verification could accept unsigned or expired tokens.
- Sync response shape could diverge from client expectations.
- Missing token secret must fail closed.

## Approval Required

No extra approval for local implementation and tests. Ask before real secrets, deploys, or remote resources.

## Work Packets

- `01-token-verification`: verify access token helper and tests.
- `02-sync-repository`: user lookup by ID.
- `03-sync-route`: authenticated `/api/sync` and empty response tests.
- `04-verification`: full checks, smoke tests, push, CI.

## Integration Policy

Security findings block push. The route is accepted only if invalid/expired tokens fail closed.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- local fail-closed smoke

## Reusable Artifacts

- `.workflow/week-08-empty-vault-sync/`
