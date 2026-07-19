# Packet 04: Real D1 Lifecycle

## Objective

Prove the complete synthetic old/new password and vault-preservation lifecycle
against local Wrangler D1, not only FakeD1.

## Evidence

- `pnpm account:password-change:lifecycle` applies all migrations to an isolated
  temporary local D1 database and starts a local Wrangler Worker on free
  loopback ports.
- HTTP observations: prelogin 200, old login 200, verify-before 200, password
  change 200, old access 401, old refresh 400, old login 400, new login 200,
  sync 200, and verify-after 200.
- D1 readback proves the new authentication hash and wrapped key, unchanged
  salt/KDF, rotated stamp, revoked old device/refresh row, active new device,
  exactly one mandatory audit row, and unchanged encrypted cipher JSON.
- `pnpm vitest run test/ops/account-password-change-lifecycle.test.ts` passes and
  rejects secret-bearing output.
- Temporary Wrangler state is removed by default, including on failures.

## Result

Completed. Real local D1 behavior matches the FakeD1 transaction model for the
full synthetic credential lifecycle.
