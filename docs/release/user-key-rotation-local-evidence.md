# User-Key Rotation Local Evidence

Target: `v0.1.0-alpha`.

Status: passed

Mode: local synthetic Wrangler Worker plus migrated D1 and local R2

Recorded at: `2026-07-20`

Issue: `HON-206`

## Purpose

This evidence records the pinned V1 user-key rotation HTTP lifecycle against an
actual local Wrangler Worker, all repository migrations, persisted D1 state,
and a local R2 sentinel. It proves that one populated supported personal-vault
generation commits atomically, old credentials stop authorizing requests, a
new password grant projects one generation after Worker restart, required-audit
failure aborts every D1 mutation, concurrent requests commit exactly one
generation, and neither the attachment object key nor bytes change.

The run uses synthetic client-derived authentication hashes, opaque wrapped
keys, encrypted folder/cipher/attachment values, and synthetic R2 bytes. It does
not use a plaintext password, an unwrapped key, decrypted vault data, a real
user, a remote Cloudflare resource, a production deployment, or an official
client binary or UI.

Real secrets: none

## Pinned Contract

- official upstream server `v2026.6.1` at
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`
- official upstream web client `web-v2026.6.1` at
  `39f07436ca60e3f25eac47777671754f288a98f1f`

The source pin defines the request shape only. This run is fixture-only and does
not promote any compatibility-matrix row. V2 signature/security data,
organization-owned ciphertext, Send, Emergency Access, organization recovery,
passkey unlock data, TDE, and Key Connector remain rejected.

## Reproduction

```sh
pnpm account:key-rotation:lifecycle
pnpm vitest run test/ops/user-key-rotation-lifecycle.test.ts
pnpm compat:test
```

The runner creates an isolated temporary persistence directory, applies every
D1 migration, seeds primary/rollback/concurrent accounts, and writes one R2
sentinel through `wrangler r2 object put --local`. It starts `wrangler dev
--local` on free loopback ports with the route explicitly enabled, restarts the
Worker against the same persisted D1/R2 state, then restarts with the route
disabled and global quota enabled. The default run removes its temporary state.
`--persist-to <path>` and `--keep-state` are available for explicit local
investigation.

Each Worker starts in its own process group. Cleanup signals the complete
Wrangler/workerd group, waits for disappearance, escalates to group SIGKILL only
after the deadline, closes inherited pipes, and fails if a descendant remains.
The passing run leaves no matching Worker or workerd process.

## HTTP Lifecycle

| Observation                                       | Status   |
| ------------------------------------------------- | -------- |
| old password login and populated sync             | 200      |
| R2-backed attachment download before rotation     | 200      |
| primary populated user-key rotation               | 200      |
| old access token after rotation and restart       | 401      |
| old refresh token and old password after rotation | 400      |
| required-audit trigger abort                      | 503      |
| pre-abort access token after rollback             | 200      |
| two concurrent rotation requests                  | 200, 401 |
| new password login after persisted Worker restart | 200      |
| new profile, sync, and backup projection          | 200      |
| R2-backed attachment download after restart       | 200      |
| disabled POST with global request quota enabled   | 501      |

The concurrent loser returned 401 because the winning request committed the new
security stamp before the second request completed bearer authentication. A
409 loser is also valid when both requests authenticate before the D1 CAS; both
outcomes allow exactly one successful generation. Repository real-D1 coverage
separately proves one `rotated` plus one `conflict` after both calls enter the
generation transaction.

## D1 And R2 Readback

The passing report asserts all of the following:

- the new authentication hash, wrapped user key, unchanged public key, newly
  wrapped private key, security stamp, and account revision form one generation
- personal folder/cipher ciphertext and uploaded attachment encrypted metadata
  carry that same revision
- the trusted device has its new wrapped public/user keys, retains its immutable
  private key, and is revoked with every pre-rotation device/session
- an already-revoked device retains its original revocation timestamp while all
  three stale wrapped-key columns are cleared in the same D1 transaction; the
  exact device manifest prevents a concurrent stale-key row from escaping that
  cleanup
- both active/approved auth requests are atomically superseded
- exactly one redacted `account.keys.rotate` audit row exists for the primary
  account
- an account-scoped required-audit trigger returns 503 while leaving its account,
  vault rows, device, refresh session, and audit count unchanged
- concurrent first/second request variants leave one internally coherent D1
  generation and exactly one required rotation audit row
- after restart, one new active device and refresh token exist; profile, sync,
  backup, and attachment download all agree with the committed generation
- the R2 object path remains the seeded `object_key`; HTTP reads and three direct
  `wrangler r2 object get --local` reads return the same bytes with SHA-256
  `8dd266f710ea4fd2862394455c5818d99b42f28a8fe9045617b09177d365283c`
- disabled POST bypasses quota persistence and leaves the complete D1 readback
  byte-equivalent

The JSON report exposes only statuses, counts, check IDs, and the R2 digest. A
test rejects any `synthetic-hon206-` value in stdout, so authentication hashes,
wrapped keys, ciphertext, object paths, and object bytes do not become release
artifacts.

## Recovery Boundary

`HONOWARDEN_USER_KEY_ROTATION_ENABLED=false` is the immediate route rollback.
It prevents new writes but does not alter a generation that already committed.
An ambiguous client response must be resolved by reading the security stamp,
revision, and required audit row. Never restore an old password hash, wrapped
user/private key, vault ciphertext, security stamp, device, or refresh token.
Recovery after commit is a separately authenticated forward generation or a
separately reviewed account-recovery procedure.

## Limits

This is local synthetic server evidence. It does not prove browser-extension,
Desktop, Android, iOS, CLI, or Web Vault rotation UI behavior. It does not
activate development, staging, or production, authorize a remote D1/R2 write,
promote official-client compatibility, or replace independent security review.
Durable notification cleanup failure remains covered by focused route tests;
this lifecycle runs with notifications disabled.

## Independent Review Boundary

The first standard review identified five correctness gaps: one unchanged
ciphertext could pass through a JSON-level comparison, attachment staleness used
the wrong revision surface, composite device IDs were rejected, revoked device
keys could survive for later reactivation, and absent legacy `favorite` data did
not default to false. All five were first captured by failing tests and then
remediated. This document does not claim final approval until the standard and
five-axis reviews are rerun against the exact publication head.
