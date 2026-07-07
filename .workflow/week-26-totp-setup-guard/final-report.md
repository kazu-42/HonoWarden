# Final Report: Week 26 TOTP Setup Guard

## Outcome

Added a safety guard to prevent TOTP setup route reuse from replacing an
already-enabled factor while the TOTP change route remains unsupported.

## Accepted Results

- `POST /identity/accounts/totp/setup` now rejects users whose account already
  has TOTP enabled.
- The guard runs before `HONOWARDEN_TOTP_SECRET` checks, so enabled accounts
  cannot be moved into pending setup by route reuse.
- Existing initial setup and setup verification behavior remains covered by
  tests.
- Current-state, auth state machine, data-flow, and release notes now describe
  the guard.

## Rejected Results

- Did not implement TOTP change; a safe version needs an explicit design for
  active and pending factors coexisting.
- Did not alter the D1 schema.

## Conflicts Resolved

No conflicts.

## Verification Evidence

- `pnpm test -- test/app.test.ts -t "TOTP setup when TOTP is already enabled"`
- `pnpm test -- test/app.test.ts -t "sets up TOTP|fails closed when TOTP setup secret|TOTP setup when TOTP is already enabled|verifies TOTP setup|requires recent password authentication for TOTP setup"`
- `pnpm check`
- `pnpm lint`
- `pnpm test` passed with 26 files and 237 tests.
- `pnpm format`
- `pnpm release:gate -- --strict` reported `overall: ready`.
- Repository brand scan returned no hits outside excluded dependency/generated
  paths.

## Remaining Risks

- TOTP change remains unsupported.
- Live client evidence for TOTP setup/change/disable remains limited.

## Reusable Follow-up

Design TOTP change as a separate workflow with either schema support for a
pending replacement factor or a documented disable-then-setup flow.
