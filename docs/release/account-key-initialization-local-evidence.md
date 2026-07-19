# Account Key Initialization Local Evidence

Target: `v0.1.0-alpha`.

Status: passed

Mode: local synthetic Wrangler Worker plus real local D1 migrations

Recorded at: `2026-07-19`

Issue: `HON-205`

## Purpose

This evidence records authenticated account-key read and one-time V1
public/wrapped-private key initialization through HonoWarden's HTTP routes and a
migrated local D1 database. It proves strict request and response compatibility,
generation-guarded atomic persistence, exact-replay idempotency, competing-write
rejection, required audit rollback, session preservation, Worker restart
readback, and the default-off route rollback.

The run uses synthetic client-derived authentication hashes and opaque
public/wrapped-private values. It does not use plaintext vault keys, a real user,
a remote Cloudflare resource, a production deployment, or an official client
binary or UI.

Real secrets: none

## Pinned Contract

- official upstream server `v2026.6.1` at
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`
- official upstream web client `web-v2026.6.1` at
  `39f07436ca60e3f25eac47777671754f288a98f1`

The pinned V1 client sends only `publicKey` and `encryptedPrivateKey`. The
pinned server permits the write only when neither account-key column is already
set and returns both the legacy key fields and nested account-key response.
HonoWarden accepts the pinned camel-case form and equivalent Pascal-case aliases
but rejects unknown, mixed, partial, or V2 fields before D1. True replacement,
signature keys, signed public keys, security state, TDE, and data rewrap remain
outside HON-205.

## Reproduction

```sh
pnpm account:keys:lifecycle
pnpm vitest run test/ops/account-key-lifecycle.test.ts
pnpm compat:test
```

The runner creates an isolated temporary Wrangler persistence directory,
applies every D1 migration, seeds four synthetic accounts, and installs
account-scoped audit-insert and user-update abort triggers. It starts
`wrangler dev --local`
on free loopback ports, exercises the enabled lifecycle, restarts against the
same D1 state, restarts again with the flag disabled, reads state back through
Wrangler, and removes the temporary directory. `--persist-to <path>` can retain
an explicitly selected local evidence database for investigation.

## HTTP Lifecycle

| Observation                                      | Status   |
| ------------------------------------------------ | -------- |
| login before initialization                      | 200      |
| missing keypair read                             | 409      |
| first V1 initialization                          | 200      |
| read after initialization                        | 200      |
| exact replay                                     | 200      |
| different replacement attempt                    | 409      |
| existing access-token sync                       | 200      |
| existing refresh-token rotation                  | 200      |
| two concurrent exact initialization requests     | 200, 200 |
| initialization with required-audit trigger abort | 503      |
| initialization with user-update trigger abort    | 503      |
| read/profile/sync/refresh after Worker restart   | 200      |
| read and write with flag disabled                | 501      |

## D1 And Session Readback

The passing report asserts all of the following:

- the primary and concurrent accounts each contain the exact opaque pair
- account revision advanced once while security stamp remained unchanged
- exactly one `account.keys.initialize` audit row exists per initialized account
- audit context contains no public or wrapped-private value
- two concurrent exact requests produced one D1 generation and one audit row
- the synthetic audit-insert abort left its rollback-account key columns null,
  original revision intact, and no audit row
- the synthetic user-update abort rolled the preceding audit reservation back
  and likewise left both key columns null and the original revision intact
- the current device and exactly one rotated refresh-token generation remain
  active
- the original access token still syncs and the original refresh session still
  rotates after initialization
- enabled Worker restart preserves GET, profile, sync, and refresh projections
- disabled GET and POST leave the complete D1 readback byte-equivalent

The compatibility fixtures separately route-replay the pinned V1 write payload
and the legacy plus nested read envelope against the Hono app.

## Atomicity And Recovery Boundary

The D1 batch first reserves the required audit row from the exact active,
both-null, security-stamp/revision source generation and then performs the
guarded user update. D1 executes the batch transactionally. A stale or already
initialized generation produces neither row; a failed audit statement aborts
before the user update; a failed update rolls the audit insert back. The
runner's two account-scoped abort triggers prove both failure orders against
real local D1 rather than only FakeD1.

An exact completed pair is a successful no-op. A different or partial pair is
not recoverable through this initializer. Operators should diagnose partial
state without logging either value and use a separately reviewed recovery path;
they must not retry with a replacement payload.

`HONOWARDEN_ACCOUNT_KEYS_ENABLED=false` is the immediate route rollback. It
stops both dedicated read and write routes without deleting initialized data.
Token, profile, sync, and backup readers remain capable of projecting a complete
stored pair. Do not roll back to code that can disclose a partial pair, and do
not activate a replacement writer as a recovery shortcut.

## Limits

This is local synthetic server evidence. It does not prove browser-extension,
Desktop, Android, iOS, CLI, or Web Vault account-key UI behavior. It does not
promote any compatibility row's `liveEvidence`, activate a tracked environment,
authorize production use, or replace an independent security review.
