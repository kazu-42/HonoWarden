# Spec: Week 14 Device Revoke

## Summary

Week 14 adds explicit device-session revocation. An authenticated device can revoke another active device belonging to the same user. Refresh grants for revoked devices fail through the existing invalid-grant path.

## Inputs

- `POST /api/devices/:id/revoke`
- `Authorization: Bearer <access token>`
- `HONOWARDEN_TOKEN_SECRET`
- target device ID in the route path

## Outputs

- Valid owner-scoped active target device:
  - `200` response with target device ID and revocation timestamp
- Current device target:
  - `400 current_device_revoke_forbidden`
- Missing, already revoked, or cross-user target:
  - `404 device_not_found`
- Refresh grant from a revoked device:
  - existing `400 invalid_grant` response

## Behavior

1. The route uses the verified access token to identify the current device.
2. The current device cannot revoke itself through this route.
3. The repository marks only an active owner-scoped target device as revoked.
4. Active refresh rows for the target device are revoked as cleanup.
5. `devices.revoked_at` remains the authoritative signal used by refresh grant rejection.

## Edge Cases

- Cross-user devices are indistinguishable from missing devices.
- Already revoked devices return `404`.
- Unknown refresh tokens remain invalid without session mutation.
- Password grant can create or reactivate the caller's current device as before.

## Acceptance Criteria

- [x] Repository tests cover active target revoke and missing target outcomes.
- [x] HTTP tests cover successful revoke, current-device rejection, and missing target.
- [x] HTTP tests cover refresh rejection when the refresh token belongs to a revoked device.
- [x] Existing auth, sync, folder, and cipher tests continue to pass.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
