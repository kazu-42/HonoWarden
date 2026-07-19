# Account KDF Change Local Evidence

Target: `v0.1.0-alpha`.

Status: passed

Mode: local synthetic Wrangler Worker plus real local D1 migrations

Recorded at: `2026-07-19`

Issue: `HON-204`

## Purpose

This evidence covers an existing account changing from PBKDF2-SHA256 to
Argon2id and back to PBKDF2 through HonoWarden HTTP routes and a fully migrated
local D1 database. It verifies exact KDF projection, atomic credential/session
mutation, old-generation rejection after both changes, new-generation login
metadata, revision and audit persistence, encrypted-vault preservation, and
unknown allowlisted prelogin tracking the stored KDF population at every
generation. It also reads the materialized population table after both changes
to prove the user trigger moved exactly one count to the committed tuple.

The runner uses synthetic client-derived authentication hashes, opaque wrapped
user keys, and encrypted vault payloads. It never supplies a plaintext master
password or unwrapped user key to HonoWarden.

Real secrets: none

## Pinned Contract

- official upstream server `v2026.6.1` at
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`
- official upstream web client `web-v2026.6.1` at
  `39f07436ca60e3f25eac47777671754f288a98f1`

Each request proves the current client-derived authentication hash and provides
one new authentication/unlock generation. Authentication and unlock data in
each request use the unchanged normalized-email salt and identical KDF
settings. HonoWarden validates the pinned inclusive bounds before either
mutation.

## Reproduction

```sh
pnpm account:kdf-change:lifecycle
pnpm vitest run test/ops/account-kdf-change-lifecycle.test.ts
```

The runner creates an isolated temporary Wrangler persistence directory,
applies all D1 migrations, seeds one synthetic account and encrypted cipher,
starts `wrangler dev --local` on free loopback ports, exercises the first
mutation, stops the Worker, reads D1 state back through Wrangler, restarts from
the same persistence directory for the reverse mutation, and performs final D1
readback with the Worker stopped. It then removes the temporary directory.
`--persist-to <path>` retains an explicitly selected local database for
investigation. The runner explicitly passes
`HONOWARDEN_KDF_MUTATION_ENABLED=true`; every tracked deployment configuration
keeps the irreversible writer false.

## Required Observations

The passing report must establish:

- known-account prelogin changes from PBKDF2 `0/600000/null/null` to Argon2id
  `1/6/32/4` and back to PBKDF2, including the current `kdfSettings` shape
- with the one seeded account, unknown allowlisted prelogin follows the same
  PBKDF2, Argon2id, and final PBKDF2 profiles, proving the decoy is selected from
  the current stored distribution rather than synthesized at a validation
  boundary
- the prior access token, refresh token, and authentication hash fail after
  each mutation
- each new authentication hash logs in and verifies
- password and refresh token responses, profile, and sync project Argon2id for
  the first generation and PBKDF2 for the final generation
- the authentication hash, wrapped user key, KDF columns, security stamp, and
  account revision commit as one generation twice
- the materialized KDF population contains exactly the committed Argon2id tuple
  after the first mutation and exactly the final PBKDF2 tuple after the second
- direct D1 readback proves the account revision advances after each mutation
- each prior device and refresh-token generation is revoked while the new
  device is active
- exactly two `account.kdf.change` audit rows exist
- encrypted cipher JSON is byte-for-byte unchanged

The report contains 38 named checks. The unknown-address fixture remains
synthetic and pending throughout the run; it is never inserted into D1.

Focused route and repository tests separately cover every bound and
just-outside value, missing Argon2id parameters, unknown algorithms, mixed
authentication/unlock data, salt drift, stale generation conflicts, every D1
batch failure, concurrency, and missing Durable Object bindings. A separate
real local-D1 migration test starts with existing users, applies `0014a`, and
proves backfill plus insert, KDF-update, and delete trigger transitions. It also
deletes the aggregate deliberately and proves the trigger aborts and rolls back
the source user update with the expected integrity error.

## Atomicity And Recovery

D1 atomically updates the user generation, revokes device and refresh sessions,
supersedes active auth requests, persists the mandatory audit event, and moves
the materialized KDF population count. A stale guard or failed statement leaves
the prior generation authoritative. The user update uses `RETURNING id`; D1
trigger changes therefore cannot be mistaken for multiple user updates.

Durable Object socket cleanup occurs after D1 commit and cannot participate in
that transaction. A missing binding fails before mutation. After commit,
cleanup runs through `waitUntil` so transport latency cannot delay HTTP 200. A
transport failure emits `account_notification_session_invalidation_failed`
without changing that acknowledgement, allowing the official client to persist
the same new KDF generation. Recovery restores notification infrastructure and
invalidates stale sockets; it never restores the old credential generation.

The rollout is two-stage: first deploy and verify all PBKDF2/Argon2id reader
paths with the writer disabled, then activate the writer in a later version
whose rollback target is reader-capable. After an Argon2id commit, recovery may
disable new writes or roll forward but must not deploy a pre-reader release.

## Limits

This is local synthetic API evidence. It does not use a remote Cloudflare
resource, production deployment, real user, or official client UI. Pinned
official-client end-to-end credential evidence remains owned by the aggregate
credential closeout issue.
