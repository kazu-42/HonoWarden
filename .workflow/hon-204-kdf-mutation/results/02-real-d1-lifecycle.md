# Packet 03 result: real local D1 lifecycle

Recorded at: `2026-07-19`

Commands:

```sh
pnpm account:kdf-change:lifecycle
pnpm vitest run test/ops/account-kdf-change-lifecycle.test.ts
```

Both commands passed on the fourth-remediation candidate. The standalone runner
completed all 18 checks, and the ops test reran the same isolated lifecycle as
part of the focused 4-file, 312-test suite.

Observed HTTP statuses:

- known-account prelogin before and after: `200`
- unknown allowlisted prelogin before and after: `200`
- old login before change: `200`
- KDF change: `200`
- old access token after change: `401`
- old refresh token and old-KDF authentication hash after change: `400`
- new login, verify, refresh, profile, and sync: `200`

D1 readback proved one Argon2id `1/6/32/4` generation, unchanged normalized
email and encrypted cipher JSON, rotated security stamp/revision, revoked old
device and refresh session, active new device, and exactly one
`account.kdf.change` audit row. With a one-account population, unknown
allowlisted prelogin tracked the stored distribution from PBKDF2
`0/600000/null/null` before mutation to Argon2id `1/6/32/4` after mutation.

The run used only synthetic hashes, wrapped keys, and encrypted payloads in a
temporary local Wrangler persistence directory. It did not touch a remote
Cloudflare resource, production, a real user, or an official client UI.
