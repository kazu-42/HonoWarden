# Week 26 Device List API

## Goal

Add read-only device list and get-by-identifier API support for authenticated
personal accounts.

## Success Criteria

- Authenticated users can call `GET /api/devices` and receive a list response
  with active devices scoped to their account.
- Authenticated users can call `GET /api/devices/identifier/:identifier` and
  receive only their own active matching device.
- Revoked, missing, or cross-user devices are not returned.
- Response fields match the client-side `DeviceResponse` shape used by tracked
  clients.
- No external compatibility brand names are introduced into repository code or
  docs.
- Narrow tests, full tests, format, strict release gate, and brand scan pass.

## Current Context

- Device records are already created and updated during password and refresh
  grants.
- Device revoke and revoke-all-other-sessions already exist.
- Compatibility matrix still lists device list and metadata APIs as incomplete.

## Constraints

- Do not implement trust/key/token mutation routes in this slice.
- Do not change the D1 schema.
- Preserve owner-scope invariants.

## Risks

- Returning cross-user devices would expose account activity metadata.
- Returning revoked devices as active could confuse session-management UI.
- Over-claiming metadata update support would mislead the compatibility matrix.

## Approval Required

No approval required for local code, docs, and tests.

## Work Packets

- Repository: list active devices by user and find active device by identifier.
- Route: add authenticated read-only device routes.
- Docs: update current state, compatibility matrix, and security docs to mark
  list/get implemented while mutation APIs remain incomplete.
- Verification: run focused and broad checks.

## Integration Policy

Keep the slice read-only. Do not alter session creation or revoke semantics.

## Verification

- `pnpm test -- test/repositories/auth-repository.test.ts -t "devices"`
- `pnpm test -- test/app.test.ts -t "device list|device by identifier"`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan

## Reusable Artifacts

This workflow documents the pattern for compatibility read endpoints: source
shape from tracked clients, owner-scope repository tests, then route tests.
