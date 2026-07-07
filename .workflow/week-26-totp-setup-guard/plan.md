# Week 26 TOTP Setup Guard

## Goal

Prevent the existing TOTP setup route from overwriting an already-enabled TOTP
configuration before a safe change route exists.

## Success Criteria

- `POST /identity/accounts/totp/setup` rejects recent-authenticated users whose
  account already has TOTP enabled.
- The guard runs before wrapping-secret checks so an enabled account cannot be
  moved into pending setup state by misconfiguration or accidental setup reuse.
- Existing initial setup and setup verification behavior remains unchanged.
- Narrow tests, full tests, format, strict release gate, and brand scan pass.

## Current Context

- `POST /identity/accounts/totp/disable` exists and deletes enabled TOTP rows.
- `TOTP change route` remains explicitly not implemented.
- The current setup repository upsert resets `enabled = 0`, so setup reuse must
  be guarded at the route layer.

## Constraints

- Do not implement full TOTP change in this slice.
- Do not alter the D1 schema.
- Do not touch external services.

## Risks

- Without this guard, a user with an enabled factor could accidentally replace
  it with pending setup state before verifying the new factor.
- A future change route must be designed separately so old factor and pending
  new factor can coexist safely.

## Approval Required

No approval required for local code, docs, and tests.

## Work Packets

- Route test: prove enabled users get a stable invalid request from setup.
- Route implementation: add early `auth.user.totpEnabled` guard.
- Docs: record the guard and keep the TOTP change route listed as not
  implemented.
- Verification: run narrow and broad local checks.

## Integration Policy

Keep the change route out of scope. This slice only prevents unsafe reuse of the
existing setup route.

## Verification

- `pnpm test -- test/app.test.ts -t "TOTP setup when TOTP is already enabled"`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan

## Reusable Artifacts

This captures the pattern for guarding existing routes while a fuller sensitive
account workflow remains out of scope.
