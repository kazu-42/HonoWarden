# Week 18 TOTP Login

## Goal

Add a tested TOTP login slice for password grant without widening the product surface beyond API-only personal/small-team vault sync.

## Success Criteria

- TOTP domain helpers generate base32 secrets and verify six-digit time-window codes.
- D1 migration persists TOTP state without storing plaintext one-time codes.
- Auth repository can create pending setup, enable TOTP after verification, record accepted time steps, and reject replay.
- Authenticated API routes expose setup and verification endpoints for an existing user.
- Password grant for a TOTP-enabled account returns a generic two-step challenge until a valid code is supplied.
- Invalid and replayed codes are rejected without changing the successful token response shape.
- `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, `pnpm format`, repository brand scan, and workflow verification pass.

## Current Context

Week 17 login defenses are implemented and CI-passing at `492b53c`. Existing password grant has device validation, login-defense buckets, password hash verification, refresh token creation, and generic invalid-grant behavior.

## Constraints

- No Web UI.
- No public registration.
- No direct external provider brand strings in tracked source/docs.
- No plaintext vault data, passwords, token secrets, TOTP codes, or real user data in fixtures/logs.
- Live Cloudflare migration/deploy/client verification require a separate gate and are out of this local implementation slice.

## Risks

- TOTP replay prevention can be bypassed if the accepted time step is not persisted atomically.
- Challenge response shape may need later live-client adjustment.
- Secret-at-rest handling is local-secret-bound in this slice, not a dedicated KMS/secrets-store design.

## Approval Required

No approval for local code, tests, docs, git push, and CI. Approval is required before live D1 migrations, deploys, production secrets, real account setup, or live client attempts.

## Work Packets

- `01-totp-domain`: Base32/HOTP/TOTP generation and verification helpers with replay-aware results.
- `02-schema-repository`: Migration and repository operations for TOTP setup, enablement, and replay state.
- `03-route-integration`: Authenticated setup/verify routes and password-grant TOTP challenge/verification.
- `04-docs-verification`: Spec, current-state, workflow evidence, gates, brand scan, and CI evidence.

## Integration Policy

Keep route handlers thin. Store encrypted/secret-bound TOTP secret material only; never store or log one-time codes. Preserve existing password and refresh token response shapes for accounts without TOTP.

## Verification

Run targeted tests during TDD, then full gates:

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verification
- GitHub Actions CI after push

## Reusable Artifacts

Week18 spec and workflow results should become the reference for later recent re-auth and security review work.
