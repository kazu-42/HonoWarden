# RECOVERY-1A: Generation-Bound Backup Contract

Status: all local gates passed; exact-head reviews pending

Linear issue: HON-224

## Start Readback

- base: `7443d3daee70d09b015c864da6033ff3246d0f75`
- branch: `feat/hon-224-generation-bound-backup`
- HON-221 and HON-224: In Progress
- HON-225 and HON-226: Todo
- HON-224 blocks HON-225; HON-225 blocks HON-226
- no deployment, remote D1/R2 mutation, production activation, real
  credentials, destructive operations, paid actions, or third-party contact

## Delivered

- Added an optional, closed schema-version-1 `credentialGeneration` binding on
  export. It combines the approved lifecycle-manifest digest with a digest of
  the exported D1 SQL and sorted R2 key/body checksums without changing unbound
  schema-version-1 backups.
- Added paired `--expected-manifest-sha256` and
  `--expected-generation-manifest-sha256` restore gates. A generation
  expectation without an exact manifest expectation is rejected.
- Read and hash manifest JSON from one byte buffer. Manifest identity and
  generation checks complete before restore command construction or spawn.
- Reused that preflight manifest digest in the restore success audit instead of
  re-reading a potentially changed file.
- Added explicit `--config` passthrough to D1 export/import and R2 get/put.
  Local D1 export uses the selected config directory's `.wrangler/state`, while
  supported D1/R2 commands also receive the matching `--persist-to` root.
- Generation-bound export is execute-only and now requires local mode, an
  explicit config, an explicit persistence root equal to
  `<config-directory>/.wrangler/state`, and an explicit R2 inventory. Remote,
  ambient, split, D1-only-by-omission, or dry-run sources fail before manifest
  construction or Wrangler spawn. Unbound backups remain compatible.
- Canonicalized the selected config and persistence paths, rejected either path
  when symlinked, and required current-user ownership, private source
  directories, and the exact mode-0600 credential-lifecycle ownership marker
  before any Wrangler process can start.
- Treated that ownership marker as preparation only. A retained lifecycle now
  writes a separate mode-0600 completion attestation after successful checks
  and process cleanup; bound export requires its lifecycle digest and durable
  state-tree digest to match the selected source before claiming output or
  spawning Wrangler.
- Excluded only SQLite `*.sqlite-shm` read-time coordination files from the
  completion state digest. Database files and `*.sqlite-wal` remain covered, so
  repeated read-only export is stable while durable or uncheckpointed changes
  invalidate the attestation.
- A bound output path must be missing or empty. Reusing a previous output fails
  before spawn, preserving the old artifact and preventing a failed replacement
  from leaving an old manifest beside partially overwritten files.
- Required every bound output to be current-user-owned at mode 0700 before the
  exclusive claim is created. A pre-existing public output is rejected without
  changing its permissions or writing backup data.
- The output is atomically claimed before Wrangler spawn and remains exclusive
  through final manifest write. Concurrent same-output exports cannot mix one
  lifecycle digest with another invocation's D1/R2 bytes. The claim is removed
  after success or handled failure; an interrupted output remains non-reusable.
- The bound manifest is written only after every export command succeeds and
  all D1/R2 checksums have been derived. A failed bound export leaves no new
  manifest that can be mistaken for a complete recovery artifact.
- Restored the exact exported D1 SQL into a private temporary validation state
  and required the explicit inventory to cover every
  `cipher_attachments.object_key` before any R2 download. The temporary state is
  removed on success or failure and is never included in the artifact.
- Rejected export-only or restore-only binding flags when used on the wrong
  command instead of silently ignoring an operator mistake.
- Required both exact approval pins whenever `restore --execute` reads a bound
  manifest. Omitting either pin now fails before command construction or
  Wrangler spawn; unbound restore compatibility and pin-free dry-run inspection
  remain unchanged.
- Kept stdout as one machine-readable JSON document during execute mode by
  routing child Wrangler progress and diagnostics to stderr. Child failures
  remain loud and cannot emit a false success packet.
- Added generation identity to secret-safe backup evidence as a digest or
  `null`; no database name, bucket name, object key/body, SQL content, password,
  token, key, ciphertext, or profile data was added.
- Updated the backup/restore runbook with Wrangler 4.112 source-state routing,
  exact recovery flags, failure order, backward compatibility, and output
  channel behavior.
- Backup tests create the shared ignored fixture root and each run-owned
  directory as mode 0700, then remove only their own UUID directory at test
  completion so real Wrangler state does not accumulate.

## Red And Green Readback

1. Six initial tests failed only because the three new binding flags and config
   routing did not exist. The implementation made all existing and new backup
   tests pass.
2. A real local Wrangler test then exposed that child banners corrupted stdout
   JSON in execute mode. Routing child output to stderr made the real export
   machine-readable without hiding failures.
3. Exact command-ownership tests reproduced silent ignore when an expected
   restore flag was passed to export or an export binding was passed to
   restore. Explicit ownership validation now fails both cases before work.
4. The first full suite exposed test-order interference: the backup fixture
   created `test/.tmp` as 0755, violating credential-lifecycle's private-root
   invariant. The fixture now creates and repairs the shared ignored root to
   0700; the combined 47-test suite and complete rerun pass.
5. Secret-boundary review reproduced a synthetic extra field flowing from a
   hand-edited `credentialGeneration` object into public evidence. The binding
   now has a closed four-field schema, evidence reconstructs only the derived
   binding digest, and the raw synthetic value never reaches successful stdout.
6. Exact-head standard review found that a digest could still label a remote,
   ambient, or split D1/R2 source as the approved generation. Four regression
   cases reproduced remote mode, missing config, missing persistence, and a
   persistence root outside the config anchor. All now fail before backup work;
   the real same-root Wrangler export still passes.
7. The next exact-head standard review found that the lifecycle digest was
   copied rather than bound to exported state and that omitting `--r2-objects`
   silently produced a D1-only artifact. The final identity is now derived from
   the lifecycle digest plus actual D1/R2 checksums, explicit R2 inventory is
   mandatory, identical source state is stable, and changed D1 state produces a
   different binding rejected by the old expectation before restore spawn.
8. A local failure-mode pass found that reusing an output could preserve an old
   bound manifest if a replacement export failed. A regression now proves
   non-empty output is rejected before Wrangler spawn and remains unchanged.
9. Exact-head standard review then reproduced an empty or incomplete explicit
   inventory producing a valid bound manifest while exported D1 still
   referenced a missing attachment body. The wrapper now restores the exact D1
   export into isolated validation persistence, queries every attachment key,
   and rejects missing inventory coverage after D1 export but before any R2 get
   or bound manifest write. A matching real Wrangler export and a verified-empty
   D1/inventory pair both pass.
10. Exact-head standard review reproduced two concurrent exports passing the
    non-atomic fresh-output check and writing a checksum-valid artifact whose
    lifecycle digest and D1/R2 bytes came from different invocations. A
    deterministic concurrent regression failed with two successful processes.
    The wrapper now acquires an exclusive output claim before spawn, holds it
    through manifest write, and produces exactly one coherent success while the
    competitor fails before Wrangler starts.
11. The next exact-head standard review found that the lexical source check
    accepted unowned or symlink-routed state and that an existing public output
    retained mode 0755. Four regressions reproduced a missing lifecycle marker,
    symlinked config, symlinked persistence, and public output. All now fail
    before Wrangler spawn; valid private owned state and output still pass.
12. Exact-head standard review at `9fa2b3a` found that a bound restore could
    execute without approval pins and that the ownership marker was written
    before lifecycle initialization, so it did not attest success or retained
    state. Regressions reproduced both missing-pin combinations, a missing
    completion file, a different lifecycle digest, and post-completion state
    drift. Bound execution now requires both pins, and export requires a
    lifecycle-digest-bound completion attestation before any spawn.
13. The first real repeat-export regression then showed that Wrangler read
    operations rewrite SQLite `*.sqlite-shm` bytes while database and WAL bytes
    remain unchanged. The state digest now ignores only regular files with that
    exact suffix; a focused regression proves shared-memory changes remain
    valid while a new `*.sqlite-wal` invalidates completion. The same real state
    exports twice with one binding, and a subsequent D1 update is rejected
    without a new manifest.

## Real Local Artifact

The latest ignored synthetic run used a private temporary Wrangler config next
to its lifecycle-owned `.wrangler/state`, initialized real local D1 and R2
sentinels, and ran an executed backup through the public CLI.

| Evidence                           | Readback                                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| Completion state-tree SHA-256      | `a669352361a38e828bfb3fae5d881f4b4fec6b440e6fbbeab0080dd9c52e23fe` |
| Backup manifest SHA-256            | `7e49c9bfb4bf42d39ac7509a90dda07e7bec7e3715a00d162d30db7756967e41` |
| Lifecycle manifest SHA-256         | `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` |
| Derived source-state SHA-256       | `572419a2ea56b346410f4a22223a492cb63cde318c524c1c4fa147cd8d2968da` |
| Derived generation-binding SHA-256 | `9ccf85631b112761a613eb8e1735c26f765650de86e2d5a673144759fa99125c` |
| D1 SQL SHA-256                     | `04205ace0c1dfbf82fa413f6bf413a14dac04be28ee3a6aa8954c38775d79fda` |
| R2 object count                    | 1                                                                  |
| R2 body SHA-256                    | `8b1b6f2f4db078d0efee07cac02495d904f02cb8a838e2818a2c42a627717549` |
| Output permissions                 | mode `0700`                                                        |
| Stdout JSON                        | parsed successfully; executed                                      |
| Same-state repeat                  | executed; generation binding identical                             |
| Post-completion D1 change          | rejected; no changed manifest written                              |
| Output claim                       | removed                                                            |
| Inventory validation state         | removed                                                            |
| Remote resources                   | none                                                               |

The repeated `f` generation digest is an explicit synthetic test value, not a
real credential or production manifest.

## Verification

```text
backup CLI focused: 44 passed
backup + scheduled workflow impact: 48 passed
backup + credential lifecycle combined: 63 passed
real local D1/R2 source export: passed
remote / ambient / split / unowned / incomplete-or-drifted / symlinked / omitted-R2 / dry-run / reused/public-output bound exports: rejected before spawn
bound restore execution missing either approval pin: rejected before command construction and spawn
concurrent same-output bound exports: exactly one coherent success; competitor rejected before spawn
incomplete D1-referenced R2 inventory: rejected after D1 export, before R2 get or manifest write
verified-empty D1 attachment set and explicit inventory: passed
generation-bound output claim: removed on success and handled failure
temporary D1 inventory-validation persistence: removed on success and failure
same source and lifecycle digest: stable derived binding
changed D1 source after completion: export rejected before output claim and spawn
manifest/history mismatch Wrangler spawns: 0
full suite: 99 files, 1,295 tests passed
typecheck / ESLint / Prettier: passed
compatibility: 105 passed
brand scan: passed
production dependency audit: no known vulnerabilities
strict release gate: 11 passed, 0 manual, 0 blocked
HON-207/HON-221 plan tests: 11 passed
git diff --check: passed
```

## Remaining Gate

Create the remediated exact candidate commit, rerun standard Codex and
independent five-axis review against that exact head, remediate any remaining
actionable P1/P2/P3, then publish PR/head CI, verify zero unresolved threads,
admin squash merge, compare candidate and merge trees, pass merged-main CI, and
close/archive HON-224 before advancing HON-225.
