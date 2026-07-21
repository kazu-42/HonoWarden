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
  the generated restore artifact creates all tables and separately declared
  parent-key UNIQUE indexes first, inserts in dependency order, applies
  views/non-unique indexes/triggers last, reimports with foreign keys enabled,
  and compares schema and every table-content digest.
- Raised the Node.js engine floor from 22.0 to 22.13, where `node:sqlite` is
  available without an experimental feature flag.
- Required a generation-bound local restore target to use canonical,
  symlink-free, current-user-owned config and target paths. The config must be
  mode `0600`; target, `.wrangler`, and persistence directories must be mode
  `0700`; persistence must be empty; and source/target paths must not overlap.
- Atomically claimed the target before Wrangler spawn. Concurrent or reused
  targets fail before import, and the owned claim is removed after success or a
  handled failure.
- Re-exported restored D1 and re-downloaded every R2 object through the exact
  target config/persistence. D1 raw bytes must match, or isolated SQLite imports
  must prove canonical schema, every table digest, and foreign-key equality
  against the checksum-pinned source export. R2 body checksums and the derived
  source-state identity must match the approved manifest before success output.
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
8. The first exact-head native review found that the declared Node.js 22.10
   floor still required `--experimental-sqlite`. A package-contract red test
   reproduced the accepted unsupported range. The package and operator docs now
   require Node.js 22.13, where `node:sqlite` is available without that flag.
9. The same review found that the aggregate signal cleanup could remove its run
   root before a nested Worker/Wrangler cleanup completed. A child-process red
   test reproduced the run-root recreation race. Shared signal cleanup now
   unwinds registrations in LIFO order, so nested resources stop before their
   owner removes the root.
10. The second exact-head native review found that a separately declared UNIQUE
    INDEX establishing a foreign-key parent key was emitted after row inserts.
    A real generation-bound export fixture reproduced SQLite's foreign-key
    mismatch. The generator now reads SQLite index metadata, creates only those
    UNIQUE indexes after all tables and before data, and retains non-unique
    indexes after data for restore performance.
11. The first post-remediation aggregate then showed that this safe schema
    reordering changes Wrangler's raw D1 export bytes even when the database is
    logically identical. A red restore-readback fixture reproduced the false
    rejection. Raw equality remains the fast path; differing exports now pass
    only after private SQLite imports prove matching canonical schema, every
    table-content digest, and zero foreign-key violations. Separate schema and
    row mismatch fixtures still fail closed.
12. The third exact-head native review found that restore setup changed the
    mode of `test/.tmp` before rejecting it as a symlink. A red fixture proved
    that a failed invocation changed an unrelated symlink target from `0755`
    to `0700`. Restore setup now rejects symlinks first and requires an existing
    fixture root to be a current-user-owned directory with mode `0700`, without
    mutating its permissions.

## Real Local Artifact

The ignored synthetic run used Node.js `v26.5.0`, Wrangler `4.112.0`, the pinned
native official CLI `2026.6.0`, real local D1/R2 persistence, and a real local
Worker/TLS origin.

| Evidence                              | Readback                                                           |
| ------------------------------------- | ------------------------------------------------------------------ |
| Generated at                          | `2026-07-21T14:05:00.000Z`                                         |
| Source lifecycle manifest SHA-256     | `ae714b4a3b2a21c27691fb7c08c702467761d07d3e67485a65b9d60e8546d669` |
| Backup manifest SHA-256               | `7133d4ed08194bc14c5d5bfb254b01bd11a2ad90d6df4f584e92ae93ab026776` |
| Generation binding SHA-256            | `414a69b61d376fc2c0c28b36c954cb728c58a831367f3b244c7e946838105f53` |
| D1/R2 source-state SHA-256            | `abc9b76792051404b00852c452cb34f406c166266cacf1d15eeadc282a1f434c` |
| Source D1 identity SHA-256            | `0f0fc9bfa5322cab4f23ea76bfa015f46069e553dde476d4ffc19e5db49d58d6` |
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
native review red/green: 4 P2 across three rounds reproduced and remediated
backup CLI: 60 tests passed, including indexed FK parents and semantic readback
signal cleanup: nested LIFO unwind; run root absent after aggregate
full suite: 99 files, 1,316 tests passed
typecheck: passed
ESLint: passed
Prettier: passed
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
