# Final Report: Week 26 Known Device API

## Outcome

Implemented anonymous known-device login preflight:

- `GET /api/devices/knowndevice`
- `X-Request-Email`: base64url-encoded UTF-8 email
- `X-Device-Identifier`: client device identifier
- valid lookups return boolean `true` or `false`

## Accepted Results

- Repository existence lookup for active user plus unrevoked device.
- Anonymous route with strict header validation and boolean response semantics.
- Route tests for known device, unknown user, cross-user device, revoked device,
  missing header, and malformed header.
- Docs updated to distinguish known-device preflight from unsupported
  metadata/trust/key mutation APIs.

## Rejected Results

- Device metadata mutation routes remain out of scope.
- Trust/key update routes remain out of scope.
- No schema migration was added.

## Conflicts Resolved

- Valid lookup misses return `false` instead of account-specific structured
  errors to avoid expanding the login enumeration surface.
- Malformed headers return `invalid_request` so client integration bugs are not
  silently treated as unknown devices.

## Verification Evidence

- `pnpm test -- test/repositories/auth-repository.test.ts -t "known device|active known device"`
- `pnpm test -- test/app.test.ts -t "known active device|known-device"`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-known-device-api`

## Remaining Risks

- No live client evidence is recorded for this endpoint yet.
- The route intentionally exposes a boolean preflight result for valid
  email/device pairs; rate limiting is still limited to login-defense surfaces.

## Reusable Follow-up

- Use this anonymous-probe pattern for any future compatibility endpoint:
  validate headers, normalize at the boundary, return minimal non-secret data,
  and keep invalid input distinct from valid misses.
