# HON-63 bulk device trust

## Goal

Close HON-63 by implementing the bulk trusted-device rotation surface while
keeping login-with-device auth-request/push behavior explicitly unsupported in
the alpha scope.

## Success Criteria

- Add authenticated `POST /api/devices/update-trust`.
- Accept bulk opaque encrypted key payloads for owner-scoped active devices by
  stable device id or device identifier.
- Return a device list response with encrypted user/public keys and never return
  encrypted private keys.
- Fail closed for invalid payloads, missing/cross-user/revoked devices, and
  auth-request/login-with-device surfaces.
- Add repository, HTTP, compat fixture, client matrix, docs, and workflow
  evidence.
- Pass focused and full repo verification before PR merge and Linear closeout.

## Current Context

Single-device encrypted key update routes already exist through
`/api/devices/:id/keys` and `/api/devices/:id/trust`. The remaining P3 gap is
bulk trusted-device rotation plus a product/security decision about
login-with-device.

## Constraints

- Preserve zero-knowledge boundaries: only opaque encrypted payloads are stored.
- Do not expose encrypted private keys in inventory, single-device, or bulk
  responses.
- Do not implement partial auth-request approval or push behavior without a
  full threat model and delivery channel.
- No production deploy or live D1 mutation for this issue.

## Risks

- A partial login-with-device implementation could create an approval bypass or
  confusing client state. The chosen alpha behavior is explicit unsupported
  responses for auth-request routes.
- Bulk updates can partially apply if device ownership changes between lookup
  and update. The implementation resolves all requested devices before batch
  update and returns `not_found` if any update reports zero changes.
- Device id vs identifier ambiguity is kept compatible with existing
  single-device behavior, but duplicate bulk targets are rejected by the parser.

## Approval Required

No approval is required for local implementation, tests, PR, CI, and Linear
updates. Approval would be required for production deploy, live D1 mutation,
or enabling push/auth-request flows.

## Work Packets

- Packet A: repository bulk trusted-device update.
- Packet B: HTTP route, parser, and explicit auth-request unsupported guards.
- Packet C: compatibility fixture, matrix, current-state, and known-limitations
  docs.
- Packet D: verification, PR, CI, merge, and Linear closeout.

## Integration Policy

Use the existing device response builder so private-key omission stays in one
place. Keep bulk trust in the device-key family and keep login-with-device
unsupported until the project owns an auth-request state machine.

## Verification

- Red: `pnpm test -- test/repositories/auth-repository.test.ts test/app.test.ts`
- Green focused: `pnpm test -- test/repositories/auth-repository.test.ts test/app.test.ts`
- Compat: `pnpm compat:test`
- Focused integration/docs: `pnpm test -- test/repositories/auth-repository.test.ts test/app.test.ts test/compat/client-matrix.test.ts test/compat/compat-fixtures.test.ts test/compat/fixture-route-replay.test.ts test/security-docs.test.ts`
- Broad checks: `pnpm format`, `pnpm check`, `pnpm lint`, `pnpm test`,
  `pnpm release:gate -- --strict`, workflow verifier, and `git diff --check`.

## Reusable Artifacts

The fixture and workflow demonstrate the pattern for adding
upstream-compatible protocol surfaces while keeping unsupported high-risk
workflows explicit.
