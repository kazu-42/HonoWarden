# Week 14 Device Revoke

## Goal

Allow one authenticated device session to revoke another device session for the same user.

## Success Criteria

- An authenticated request can revoke an active owner-scoped target device.
- The current device from the access token cannot revoke itself through this route.
- Missing, already revoked, or cross-user devices return `404`.
- Refresh grants for revoked devices fail with the existing invalid-grant behavior.
- Full local checks and CI pass.

## Current Context

- Device rows already include `revoked_at`.
- Refresh token lookup already exposes `deviceRevokedAt`.
- Refresh grant logic already rejects revoked devices.
- No explicit device revoke API exists.

## Constraints

- Do not add a migration unless the existing schema cannot support the slice.
- Do not log or expose refresh token hashes.
- Keep upstream-provider brand strings out of tracked files.
- Do not deploy or touch real secrets.

## Risks

- Revoking the current device could unexpectedly lock out the caller.
- A cross-user target must not reveal whether another user's device exists.
- Refresh token cleanup can fail after device revocation; `devices.revoked_at` must remain the authoritative refresh rejection signal.

## Approval Required

No extra approval is required for local implementation, tests, git push, and CI under the sustained repo-development request. Ask before deploys, real secrets, destructive git, billing, or production data.

## Work Packets

- `01-repository-device-revoke`: add owner-scoped active device revoke repository operation.
- `02-route-device-revoke`: add authenticated revoke route and current-device guard.
- `03-refresh-coverage-docs`: add revoked-device refresh coverage and docs.
- `04-verification`: run local gates, brand scan, workflow verification, push, and CI.

## Integration Policy

Do not ship if self-revoke succeeds, if cross-user devices leak, or if a revoked device can still refresh.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verification
- GitHub Actions CI

## Reusable Artifacts

- `.workflow/week-14-device-revoke/`
