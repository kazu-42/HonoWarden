# Week 26 TOTP Disable

## Goal

Add a small, tested TOTP disable API slice for the alpha authentication
surface.

## Success Criteria

- Recent password-authenticated users can disable their own enabled TOTP setup.
- Stale password-auth, refresh-auth, and legacy access tokens are rejected by
  the existing recent-auth guard.
- Disabling TOTP clears stored TOTP secret material and replay state.
- Missing, already disabled, or cross-user state returns a stable client error.
- Successful disable emits a secret-safe audit event when audit logging is
  enabled.
- Narrow tests, full tests, lint, format, strict release gate, and repository
  brand scan pass.

## Current Context

- TOTP setup and setup verification already exist.
- Recent password-auth guards protect setup routes and revoke-all-sessions.
- `user_totp` stores encrypted setup secret, enabled state, verified timestamp,
  and last accepted step.
- `session.revoke_all` was added in the previous slice and CI is green at
  `b95891a`.

## Constraints

- Do not add public registration, web vault, organizations, or send surfaces.
- Do not leave external compatibility brand names in code identifiers or docs.
- Do not touch Cloudflare, Linear, DNS, or email settings in this local slice.
- Preserve existing route and repository patterns.

## Risks

- Accidentally leaving encrypted TOTP material after disable would increase
  account recovery and secret-retention risk.
- Allowing refresh-issued tokens to disable TOTP would weaken recent-auth
  guarantees.
- Returning too much detail in audit metadata could expose account or secret
  context.

## Approval Required

No approval required for local tests, docs, and code changes. Approval would be
required before deployment or external service writes; this workflow will not do
those.

## Work Packets

- Repository: add `disableTotpSetup` with tests for enabled-only update,
  cleared secret/replay fields, and missing-state result.
- Route: add authenticated TOTP disable endpoint using recent password auth.
- Audit and docs: add `totp.disable` event and update alpha state docs.
- Verification: run narrow tests, full checks, strict gate, and brand scan.

## Integration Policy

Integrate directly in the main worktree. Keep each change scoped to the TOTP
disable slice and avoid unrelated refactors.

## Verification

- `pnpm test -- test/repositories/totp-repository.test.ts -t "disables"`
- `pnpm test -- test/app.test.ts -t "TOTP disable|disables TOTP|requires recent"`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan

## Reusable Artifacts

This workflow documents the pattern for adding sensitive-account operations
behind the recent password-auth guard.
