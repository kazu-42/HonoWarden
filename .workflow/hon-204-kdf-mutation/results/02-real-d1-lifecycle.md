# Packet 03 result: real local D1 lifecycle

Recorded at: `2026-07-19`

Commands:

```sh
pnpm account:kdf-change:lifecycle
pnpm vitest run test/ops/account-kdf-change-lifecycle.test.ts
```

Both commands passed on the eighth-remediation candidate. The standalone runner
completed all 36 checks, and the ops test reran the same isolated round-trip
lifecycle.

Observed HTTP statuses:

- known-account prelogin before, after Argon2id mutation, and after PBKDF2
  round trip: `200`
- unknown allowlisted prelogin at all three generations: `200`
- old login before change: `200`
- PBKDF2-to-Argon2id and Argon2id-to-PBKDF2 KDF changes: `200`
- each prior-generation access token after its change: `401`
- each prior-generation refresh token and authentication hash after its change:
  `400`
- each new-generation login, verify, refresh, profile, and sync: `200`

D1 readback after each stopped Worker proved an Argon2id `1/6/32/4` generation
followed by PBKDF2 `0/600000/null/null`. The first revision advanced from the
seeded `2026-07-19T00:00:00.000Z` value to
`2026-07-19T11:45:49.765Z`; the final revision advanced again to
`2026-07-19T11:45:51.641Z`. Each generation retained the normalized email and
encrypted cipher JSON, rotated the security stamp, revoked the prior device and
refresh session, activated the new device, and added one
`account.kdf.change` audit row for a final count of two. With a one-account
population, unknown allowlisted prelogin tracked the same stored KDF profile at
every generation.

The run used only synthetic hashes, wrapped keys, and encrypted payloads in a
temporary local Wrangler persistence directory. It did not touch a remote
Cloudflare resource, production, a real user, or an official client UI.
