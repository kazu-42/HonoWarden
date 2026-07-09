# Packet A: Repository

Objective: add owner-scoped bulk trusted-device key rotation.

Completed:

- Added `updateTrustedDeviceKeys`.
- Resolved requested devices by stable device id or device identifier.
- Rejected missing, cross-user, or revoked devices before batch update.
- Returned updated `DeviceRecord`s in request order.

Verification:

- `pnpm test -- test/repositories/auth-repository.test.ts test/app.test.ts`
