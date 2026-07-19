# Account Password Change Local Evidence

Target: `v0.1.0-alpha`.

Status: passed

Mode: local synthetic Wrangler Worker plus real local D1 migrations

Recorded at: `2026-07-19`

Issue: `HON-203`

## Purpose

This evidence records the complete existing-account master-password generation
change through HonoWarden's HTTP routes and a migrated local D1 database. It
proves current-password verification, atomic credential/session mutation,
old-generation rejection, new-generation login and unlock metadata, required
audit persistence, and encrypted-vault preservation.

The run uses synthetic client-derived authentication hashes, opaque wrapped
user keys, and encrypted vault payloads. It does not use a plaintext master
password, real user, remote Cloudflare resource, production deployment, or
official client UI.

Real secrets: none

## Pinned Contract

- official upstream server `v2026.6.1` at
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`
- official upstream web client `web-v2026.6.1` at
  `39f07436ca60e3f25eac47777671754f288a98f1`

The pinned client constructs structured authentication/unlock data and also
includes the transitional legacy hash/key fields. HonoWarden accepts
structured-only, legacy-only, and matching dual representations; conflicting
dual representations fail closed. Structured KDF and salt must match each
other and the stored account generation.

## Reproduction

```sh
pnpm account:password-change:lifecycle
pnpm vitest run test/ops/account-password-change-lifecycle.test.ts
```

The runner creates an isolated temporary Wrangler persistence directory,
applies every D1 migration, seeds one synthetic account and encrypted cipher,
starts `wrangler dev --local` on free loopback ports, executes the lifecycle,
stops the Worker, reads D1 state back through Wrangler, and removes the
temporary directory. `--persist-to <path>` can retain an explicitly selected
local evidence database for investigation.

## HTTP Lifecycle

| Observation                       | Status |
| --------------------------------- | ------ |
| prelogin before change            | 200    |
| old-password login before change  | 200    |
| verify old password before change | 200    |
| password generation change        | 200    |
| old access token after change     | 401    |
| old refresh token after change    | 400    |
| old-password login after change   | 400    |
| new-password login after change   | 200    |
| sync with new generation          | 200    |
| verify new password after change  | 200    |

## D1 And Vault Readback

The passing report asserts all of the following:

- authentication hash and opaque wrapped user key were replaced
- normalized-email salt and PBKDF2 parameters were unchanged
- security stamp was rotated
- old device and refresh-token rows were revoked
- the new device remains active
- exactly one `account.password.change` audit row was persisted
- audit output contains no authentication hash or wrapped user key
- the encrypted cipher JSON is byte-for-byte unchanged

Focused FakeD1 and route tests also prove concurrent generation conflicts,
wrong proof, malformed or oversized values, salt/KDF drift, non-empty hints,
failure at every D1 batch statement, and missing notification bindings do not
partially mutate credentials or sessions.

## Atomicity And Recovery Boundary

The D1 batch is the atomic boundary for the user generation, device and refresh
revocation, auth-request supersession, and required audit row. A stale guard or
failed statement leaves the prior generation authoritative and supports a
normal retry after the infrastructure issue is corrected.

Durable Object notification socket invalidation runs after D1 commit and cannot
be rolled back with D1. If that cleanup fails, the route returns HTTP 503 with
`session_revocation_incomplete`; the new credential generation and D1 session
revocation remain committed, and old bearer tokens still fail their security
stamp check. Operators should treat that response as committed-with-cleanup-
failure, restore the notification binding, and retry socket invalidation rather
than retrying the old password-change payload blindly.

## Limits

This is local synthetic server evidence. It does not prove browser-extension,
Desktop, Android, iOS, CLI, or Web Vault password-change UI behavior. It does
not promote any compatibility row's `liveEvidence`, authorize production use,
or replace an independent security review.
