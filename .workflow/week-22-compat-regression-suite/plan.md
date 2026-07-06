# Week 22 Compatibility Regression Suite

## Goal

Turn the compatibility matrix into a testable fixture contract for the alpha
client-sync surface.

## Success Criteria

- Every matrix `coveredFlows` entry maps to at least one checked fixture.
- Fixtures cover auth prelogin, password and refresh token grants, TOTP login,
  sync, folder CRUD, cipher create/lifecycle, revision conflicts, and device
  revoke.
- Fixture assertions can validate array entries as well as object fields.
- Docs explain the fixture manifest and the conservative verification level.
- Local gates, brand scans, workflow verifier, and CI pass.

## Current Context

Week 15 introduced a conservative client matrix, but the fixture corpus only
covered prelogin, token grants, and empty sync. Week 22 closes the gap by making
the declared protocol flows executable fixture inventory.

## Constraints

- Use only synthetic fixture data.
- Do not record live client secrets, vault exports, token values, or personal
  vault data.
- Keep verification at `fixture_only` until live client evidence exists.
- Do not introduce direct external provider brand strings in tracked files.

## Risks

- Declaring broad compatibility without fixture coverage can hide unsupported
  client paths.
- Overly rigid fixtures can block harmless future response additions.
- Fixture-only evidence does not prove a real client binary completed a sync.

## Approval Required

No approval is required for local fixtures, tests, docs, git push, and CI. Live
client capture or external Linear/Cloudflare writes require a separate gate.

## Work Packets

- `01-fixture-manifest`: Add fixture-flow inventory and matrix-to-fixture
  consistency checks.
- `02-alpha-critical-fixtures`: Add fixtures for folder, cipher, TOTP, revision
  conflict, sync-with-items, and device revoke flows.
- `03-docs-verification`: Document the regression suite and record verification
  evidence.

## Integration Policy

Fixtures pin only required response fields and stable status codes. Unknown
future encrypted payload fields should remain allowed unless they change
server-owned metadata.

## Verification

- `pnpm test -- test/compat`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI

## Reusable Artifacts

The fixture-flow manifest should be reused whenever the client matrix gains or
loses a covered flow.
