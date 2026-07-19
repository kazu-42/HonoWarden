# Packet 03 result: real local D1 lifecycle

Recorded at: `2026-07-19`

Commands:

```sh
pnpm account:kdf-change:lifecycle
pnpm vitest run test/ops/account-kdf-change-lifecycle.test.ts
```

Both commands passed. The direct runner completed all 17 checks, and the ops
test reran the isolated lifecycle in 11.57 seconds.

Observed HTTP statuses:

- prelogin before and after: `200`
- old login before change: `200`
- KDF change: `200`
- old access token after change: `401`
- old refresh token and old-KDF authentication hash after change: `400`
- new login, verify, refresh, profile, and sync: `200`

D1 readback proved one Argon2id `1/6/32/4` generation, unchanged normalized
email and encrypted cipher JSON, rotated security stamp/revision, revoked old
device and refresh session, active new device, and exactly one
`account.kdf.change` audit row.

The run used only synthetic hashes, wrapped keys, and encrypted payloads in a
temporary local Wrangler persistence directory. It did not touch a remote
Cloudflare resource, production, a real user, or an official client UI.
