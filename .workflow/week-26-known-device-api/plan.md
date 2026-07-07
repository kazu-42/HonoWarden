# Week 26 Known Device API

## Goal

Add the anonymous known-device lookup used during login preflight.

## Success Criteria

- `GET /api/devices/knowndevice` returns `true` when the decoded request email
  and device identifier match an existing active account device.
- The route returns `false` for unknown users, unknown devices, cross-user
  devices, and revoked devices.
- Missing or malformed headers return stable `400 invalid_request` responses.
- The route does not require bearer authentication and does not reveal account
  state beyond a boolean.
- Narrow tests, broad checks, strict release gate, workflow verifier, and brand
  scan pass.

## Current Context

- `GET /api/devices` and `GET /api/devices/identifier/:identifier` are
  implemented.
- Password grant creates or updates device rows.
- Primary source shows the login preflight route uses:
  - `GET /devices/knowndevice`
  - `X-Request-Email`: base64url-encoded UTF-8 email
  - `X-Device-Identifier`: client-generated device identifier
  - boolean response

## Constraints

- Do not implement trust/key mutation APIs in this slice.
- Do not add a D1 migration.
- Keep response semantics boolean-only for successful requests.
- Do not introduce external compatibility brand names into repository files.

## Risks

- Treating malformed header values as false could hide client integration bugs.
- Returning user-specific errors would create a login enumeration surface.
- Ignoring revoked devices would mark stale devices as known.

## Approval Required

No approval required for local code, tests, and docs.

## Work Packets

- Repository: active-device lookup by normalized email and identifier.
- Route: anonymous known-device route with base64url header decoding.
- Docs: update current state, compatibility matrix, and security data flow.
- Verification: run focused and broad checks.

## Integration Policy

Keep the route read-only and isolated from authenticated device inventory
routes.

## Verification

- focused repository tests
- focused route tests
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier

## Reusable Artifacts

This workflow captures the pattern for anonymous compatibility probes:
parse/validate headers, normalize inputs, return boolean for valid lookups, and
avoid account-specific errors.
