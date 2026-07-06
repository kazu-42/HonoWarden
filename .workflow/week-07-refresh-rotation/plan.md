# Week 7 Refresh Rotation

## Goal

Implement refresh token grant support with rotation and reuse invalidation.

## Success Criteria

- Refresh grant returns a new access token and new refresh token.
- Refresh token plaintext is never stored.
- Old refresh token is revoked before a replacement is usable.
- Reuse of a revoked token invalidates active tokens for the same user/device session.
- Disabled users and revoked devices cannot refresh.
- Tests and CI pass.

## Current Context

- Week 6 password grant is pushed and CI-green.
- D1 schema already has refresh token rotation columns: `rotated_from_token_id`, `revoked_at`, `expires_at`.
- Access token signing and refresh token hashing helpers already exist.

## Constraints

- Do not commit real token secrets.
- Keep unknown/reused/wrong refresh token failures indistinguishable to clients.
- Keep route handlers as thin as practical.
- Keep upstream-provider brand strings out of tracked files.

## Risks

- Reuse detection could fail open if revoked token lookup loses user/device context.
- Rotation could accidentally store plaintext refresh tokens.
- Concurrent refreshes could create multiple active children if conditional revoke is not checked.

## Approval Required

No extra approval for local implementation and tests. Ask before real secrets, deploys, or remote resource mutation.

## Work Packets

- `01-refresh-domain`: parse refresh grant and shared token response helpers.
- `02-refresh-repository`: lookup, rotate, and invalidate refresh token sessions.
- `03-route-fixture-docs`: HTTP integration, fixture, docs, and tests.
- `04-verification`: full checks, smoke tests, push, CI.

## Integration Policy

Security findings block push. Repository behavior must prove hash-only storage and conditional rotation.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- local smoke for fail-closed paths

## Reusable Artifacts

- `.workflow/week-07-refresh-rotation/`
