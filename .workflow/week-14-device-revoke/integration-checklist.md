# Integration Checklist: week-14-device-revoke

## 01 Repository Device Revoke

# Packet 01 Result: Repository Device Revoke

Accepted:

- Added `revokeDeviceSession` to mark active owner-scoped devices revoked.
- Active refresh rows for the target device are revoked after the device row is marked revoked.
- Missing, cross-user, and already revoked device targets return `not_found`.
  Verification:
- Targeted auth repository tests passed.
- `pnpm check` passed after the repository contract was integrated.
  Remaining risks:
- Token cleanup is secondary to `devices.revoked_at`, which remains the authoritative refresh rejection signal.

## 02 Route Device Revoke

# Packet 02 Result: Route Device Revoke

Accepted:

- Added authenticated `POST /api/devices/:id/revoke`.
- Protected auth context now returns the verified access-token device identifier.
- The current device cannot revoke itself through this route.
- Missing, cross-user, and already revoked device targets return `404 device_not_found`.
  Verification:
- Targeted app tests passed.
- Fake D1 can simulate successful and missing device revoke writes.
  Remaining risks:
- Device list and metadata update endpoints are still deferred.

## 03 Refresh Coverage Docs

# Packet 03 Result: Refresh Coverage Docs

Accepted:

- Added HTTP coverage for refresh grants from revoked devices.
- Updated Week 14 spec.
- Updated current-state documentation.
  Verification:
- Targeted app tests passed.
- Docs remain scoped to the implemented revoke slice.
  Remaining risks:
- Live client compatibility needs exact client-version capture in the Week 15 matrix.

## 04 Verification

# Packet 04 Result: Verification

Accepted:

- Local verification started after implementation and docs were integrated.
  Verification:
- `pnpm check`: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 12 files and 123 tests.
- `pnpm compat:test`: passed, 1 file and 5 tests.
- `pnpm format`: passed.
- Workflow verification: passed.
- Repository brand scan: no hits.
- Local HTTP smoke: sync without token secret returns `503 server_misconfigured`.
  Remaining risks:
- CI result is still pending until the implementation is pushed.

## Integration Decisions

Accepted:

Rejected:

Conflicts:

Remaining risks:

Verification still needed:
