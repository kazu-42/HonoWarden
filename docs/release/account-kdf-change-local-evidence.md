# Account KDF Change Local Evidence

Target: `v0.1.0-alpha`.

Status: passed

Mode: local synthetic Wrangler Worker plus real local D1 migrations

Recorded at: `2026-07-19`

Issue: `HON-204`

## Purpose

This evidence covers an existing account changing from PBKDF2-SHA256 to
Argon2id through HonoWarden HTTP routes and a fully migrated local D1 database.
It verifies exact KDF projection, atomic credential/session mutation,
old-generation rejection, new-generation login metadata, required audit
persistence, and encrypted-vault preservation.

The runner uses synthetic client-derived authentication hashes, opaque wrapped
user keys, and encrypted vault payloads. It never supplies a plaintext master
password or unwrapped user key to HonoWarden.

Real secrets: none

## Pinned Contract

- official upstream server `v2026.6.1` at
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`
- official upstream web client `web-v2026.6.1` at
  `39f07436ca60e3f25eac47777671754f288a98f1`

The request proves the old client-derived authentication hash and provides one
new authentication/unlock generation. Both data sets use the unchanged
normalized-email salt and identical Argon2id settings. HonoWarden validates the
pinned inclusive bounds before any mutation.

## Reproduction

```sh
pnpm account:kdf-change:lifecycle
pnpm vitest run test/ops/account-kdf-change-lifecycle.test.ts
```

The runner creates an isolated temporary Wrangler persistence directory,
applies all D1 migrations, seeds one synthetic account and encrypted cipher,
starts `wrangler dev --local` on free loopback ports, exercises the complete
lifecycle, reads D1 state back through Wrangler, stops the Worker, and removes
the temporary directory. `--persist-to <path>` retains an explicitly selected
local database for investigation.

## Required Observations

The passing report must establish:

- known-account prelogin changes from PBKDF2 `0/600000/null/null` to Argon2id
  `1/6/32/4`, including the current `kdfSettings` shape
- the old access token, refresh token, and old-KDF authentication hash fail
- the new authentication hash logs in and verifies
- password and refresh token responses, profile, and sync all project Argon2id
- the authentication hash, wrapped user key, KDF columns, security stamp, and
  account revision commit as one generation
- old device and refresh-token rows are revoked while the new device is active
- exactly one `account.kdf.change` audit row exists
- encrypted cipher JSON is byte-for-byte unchanged

Focused route and repository tests separately cover every bound and
just-outside value, missing Argon2id parameters, unknown algorithms, mixed
authentication/unlock data, salt drift, stale generation conflicts, every D1
batch failure, concurrency, and missing Durable Object bindings.

## Atomicity And Recovery

D1 atomically updates the user generation, revokes device and refresh sessions,
supersedes active auth requests, and persists the mandatory audit event. A
stale guard or failed statement leaves the prior generation authoritative.

Durable Object socket cleanup occurs after D1 commit and cannot participate in
that transaction. A cleanup failure returns `session_revocation_incomplete` and
keeps the new generation. Recovery restores notification infrastructure and
invalidates stale sockets; it never restores the old credential generation.

## Limits

This is local synthetic API evidence. It does not use a remote Cloudflare
resource, production deployment, real user, or official client UI. Pinned
official-client end-to-end credential evidence remains owned by the aggregate
credential closeout issue.
