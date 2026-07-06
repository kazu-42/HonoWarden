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
