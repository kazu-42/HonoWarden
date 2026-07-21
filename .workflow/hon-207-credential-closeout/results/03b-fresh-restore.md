# RECOVERY-1B: Fresh Restore And Stale-Generation Rejection

Status: local implementation and integrated recovery proof passed; exact-head
reviews and repository publication pending

Linear issue: HON-225

## Start Readback

- base: `27388e56e54c8b7bd67249bc9cf4fea5401d3a7a`
- branch: `feat/hon-225-fresh-generation-restore`
- predecessor HON-224: Done and archived after PR #112 and exact-main CI
- HON-225: In Progress and non-archived
- HON-226: Todo and non-archived
- no deployment, remote D1/R2 mutation, production activation, real
  credentials, destructive operation, paid action, or third-party contact

## Delivered

- Added `pnpm account:credential-restore:lifecycle` as a dry-run-first aggregate
  contract. Execute mode requires an exact confirmation and one direct
  mode-`0700` child of `test/.tmp` as its run root.
- Extended generation-bound backup manifests with an optional, checksum-pinned
  `d1-restore.sql`. Unbound schema-version-1 backups remain compatible and
  continue to import their original `d1.sql`.
- Replaced string-level or Wrangler-order-dependent D1 validation with private
  `node:sqlite` databases. The source import rejects foreign-key violations;
  the generated restore artifact creates all tables first, inserts in
  dependency order, applies views/indexes/triggers last, reimports with foreign
  keys enabled, and compares schema and every table-content digest.
- Raised the Node.js engine floor from 22.0 to 22.10, which provides the
  `DatabaseSync` options used by the validator.
- Required a generation-bound local restore target to use canonical,
  symlink-free, current-user-owned config and target paths. The config must be
  mode `0600`; target, `.wrangler`, and persistence directories must be mode
  `0700`; persistence must be empty; and source/target paths must not overlap.
- Atomically claimed the target before Wrangler spawn. Concurrent or reused
  targets fail before import, and the owned claim is removed after success or a
  handled failure.
- Re-exported restored D1 and re-downloaded every R2 object through the exact
  target config/persistence. D1 bytes, R2 body checksums, and the derived
  source-state digest must match the approved manifest before success output.
- Captured a recovery context only in memory after the source lifecycle. Four
  authenticated stale official profiles are snapshotted while their generation
  is current, then cloned into one-use profiles for restored verification.
- Reused the exact source loopback HTTPS origin after bounded source cleanup so
  authenticated official profiles keep their server binding without changing
  normal browser or global CLI state.
- Proved four old passwords, access tokens, refresh tokens, and authenticated
  official profiles are rejected both before and after restored Worker restart.
  Empty or logged-out profile errors are not accepted as stale-generation
  evidence.
- Proved the current access token and refresh token are accepted, and the pinned
  official CLI completes login, lock, unlock, sync, and decrypted item read
  before and after restart.
- Kept raw passwords, tokens, sessions, wrappers, ciphertext, item values, and
  profile contents out of argv, stdout packets, manifests, and tracked evidence.
  Bounded cleanup removes the run-owned source, backup, target, TLS material,
  and tracked process groups on success or failure.

## Red And Green Readback

1. The first real validator failed because Wrangler emitted child table
   statements before parent table statements. A valid out-of-order fixture and
   a foreign-key-invalid fixture now distinguish import ordering from corrupt
   state.
2. The actual Wrangler restore failed for the same ordering reason. The
   equivalent `d1-restore.sql` artifact was introduced only after a second
   foreign-key-on import and exact schema/table comparison passed.
3. Restored stale-profile checks initially observed only `not logged in`
   because source lifecycle checks had already invalidated those profile files.
   Generation-time snapshots and strict server rejection markers made the test
   prove stale authentication rather than local profile absence.
4. Snapshot-derived names exceeded the official CLI's 64-character profile
   limit. Restore phase profiles now use deterministic, unique, bounded names.
5. An authenticated profile refused a new server origin. The recovery context
   now validates one explicit `https://localhost:<port>` origin, source cleanup
   releases it, and the restored TLS proxy reclaims that exact port while
   backend and inspector ports remain distinct.
6. The first current-access check targeted a nonexistent route and correctly
   returned 404 after every stale check passed. Both current access checks now
   use the existing authenticated `/api/sync` contract.
7. Final code inspection found that table dependency ordering alone did not
   cover a valid self-reference whose child row preceded its parent row. A red
   fixture reproduced the failure. The restore artifact now defers all foreign
   keys inside one transaction, so self-references and cycles remain row-order
   independent while commit and post-import checks still fail closed.

## Real Local Artifact

The ignored synthetic run used Node.js `v26.5.0`, Wrangler `4.112.0`, the pinned
native official CLI `2026.6.0`, real local D1/R2 persistence, and a real local
Worker/TLS origin.

| Evidence                              | Readback                                                           |
| ------------------------------------- | ------------------------------------------------------------------ |
| Generated at                          | `2026-07-21T12:40:16.000Z`                                         |
| Source lifecycle manifest SHA-256     | `d3d419cf9b28bf39795f90a84ccd8e162ad432cd0c56407e9926d09c292a5974` |
| Backup manifest SHA-256               | `1cefeb938c3e5e3f268a96d95fdbfa5b427d32afc2b3fd0eb84feb83c6595277` |
| Generation binding SHA-256            | `14054d7a0267de04e37f3db865a06a902857c7aa4d044afbaf9ab36bedc011b7` |
| D1/R2 source-state SHA-256            | `38a0bc3bc00e5008ee7c332fde0dd34f32f63561412c48f0307de504bc6b8e89` |
| D1 export SHA-256                     | `fe83270da6ab4d82bfa8f48ef10fce687b7f921246b46338ec8bedcfe3f42421` |
| R2 object count                       | 1                                                                  |
| Stale password/access/refresh/profile | 4 each before restart; 4 each after restart                        |
| Current session                       | access and refresh passed; refreshed access passed after restart   |
| Official CLI                          | decrypted item read passed before and after restart                |
| Foreign-key violations                | 0                                                                  |
| Source completion state               | unchanged                                                          |
| Run-root cleanup                      | removed; retained secret files `0`                                 |
| Remote resources                      | none                                                               |

All values above are synthetic digests or aggregate counts. They are not
credentials, vault exports, object keys, user identifiers, or production data.

## Verification

```text
real aggregate source -> backup -> fresh restore -> credential proof: passed
full suite: 99 files, 1,311 tests passed
typecheck: passed
ESLint: passed
Prettier: passed after formatting the changed lifecycle file
compatibility: 105 passed
brand scan: passed
production dependency audit: no known vulnerabilities
strict release gate: 11 passed, 0 manual, 0 blocked
HON-207/HON-221 plan tests: 11 passed
git diff --check: passed
residual HON-225 Wrangler/workerd processes: 0
run-owned source/backup/target root: removed
temporary D1 inspection root: removed
```

## Remaining Gate

Run exact-diff standard and five-axis reviews, remediate every actionable
finding, rerun the full repository gates at the reviewed head, publish the PR,
pass exact-head CI with zero unresolved review threads, squash with tree
equality, pass merged-main CI, then move HON-225 to Done/archive before starting
HON-226.
