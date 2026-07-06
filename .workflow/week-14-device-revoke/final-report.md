# Final Report: Week 14 Device Revoke

## Outcome

Device revoke is implemented for authenticated API clients. A caller can revoke another active device owned by the same user, the current device is protected from self-revoke on this route, and refresh grants from revoked devices fail through the existing invalid-grant path.

## Accepted Results

- Added `revokeDeviceSession` repository operation.
- Added active refresh token cleanup for revoked devices.
- Added authenticated `POST /api/devices/:id/revoke`.
- Extended protected auth context with the verified device identifier.
- Added tests for successful revoke, missing target, self-revoke rejection, and revoked-device refresh rejection.
- Updated Week 14 spec, current-state docs, and workflow artifacts.

## Rejected Results

- No schema migration was added.
- No device list API was added.
- No device metadata update API was added.
- No real token secrets were set.
- No Cloudflare deploy was performed.

## Conflicts Resolved

- None.

## Verification Evidence

- `pnpm check`: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 12 files and 123 tests.
- `pnpm compat:test`: passed, 1 file and 5 tests.
- `pnpm format`: passed.
- Repository brand scan: no hits.
- Workflow verification: passed.
- Local HTTP smoke: sync without token secret returns `503 server_misconfigured`.
- GitHub Actions CI: passed for implementation commit `c782ad5` in run `28788405737`.

## Remaining Risks

- The route requires a known target device ID; device listing remains a future slice.
- Live client behavior still needs Week 15 compatibility matrix evidence.

## Reusable Follow-up

- Week 15 should capture exact upstream client versions and verify which device-management endpoints the official clients call.
