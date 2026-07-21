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

- Added optional `credentialGeneration.manifestSha256` binding on export via
  `--generation-manifest-sha256` without changing unbound schema-version-1
  backups.
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
- Generation-bound export now requires local mode, an explicit config, and an
  explicit persistence root equal to `<config-directory>/.wrangler/state`.
  Remote, ambient, or split D1/R2 sources fail before object discovery,
  manifest construction, or Wrangler spawn. Unbound backups remain compatible.
- Rejected export-only or restore-only binding flags when used on the wrong
  command instead of silently ignoring an operator mistake.
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
   now has a closed one-field schema, evidence reconstructs only the digest,
   and the raw synthetic value never reaches successful stdout.
6. Exact-head standard review found that a digest could still label a remote,
   ambient, or split D1/R2 source as the approved generation. Four regression
   cases reproduced remote mode, missing config, missing persistence, and a
   persistence root outside the config anchor. All now fail before backup work;
   the real same-root Wrangler export still passes.

## Real Local Artifact

The latest ignored synthetic run used a private temporary Wrangler config next
to its `.wrangler/state`, initialized real local D1 and R2 sentinels, and ran an
executed backup through the public CLI.

| Evidence                    | Readback                                                           |
| --------------------------- | ------------------------------------------------------------------ |
| Manifest SHA-256            | `d01e4a0cbb926ebcb1b5ca6a3a14523141f12a5bfd1471979dcc447e833d3871` |
| Generation manifest SHA-256 | `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` |
| D1 SQL SHA-256              | `78308c7940956b5a1f5e04fe39a72b13ae4f3d3af257f888f9afce4540554d2c` |
| R2 object count             | 1                                                                  |
| R2 body SHA-256             | `ea94c5ee893ca30697f8309290566c08d4d52213eee17f02826f22c23f9bf962` |
| Stdout JSON                 | parsed successfully                                                |
| Remote resources            | none                                                               |

The repeated `f` generation digest is an explicit synthetic test value, not a
real credential or production manifest.

## Verification

```text
backup CLI focused: 29 passed
backup + scheduled workflow impact: 33 passed
backup + credential lifecycle combined: 47 passed
real local D1/R2 source export: passed
remote / ambient / split generation-bound exports: rejected before backup work
manifest/history mismatch Wrangler spawns: 0
full suite: 99 files, 1,279 tests passed
typecheck / ESLint / Prettier: passed
compatibility: 105 passed
brand scan: passed
production dependency audit: no known vulnerabilities
strict release gate: 11 passed, 0 manual, 0 blocked
HON-207/HON-221 plan tests: 11 passed
git diff --check: passed
```

## Remaining Gate

Create a remediated exact candidate commit, rerun standard Codex and independent
five-axis review against that exact head, remediate any remaining actionable
P1/P2/P3, then publish PR/head CI, verify zero unresolved threads, admin squash
merge, compare candidate and merge trees, pass merged-main CI, and close/archive
HON-224 before advancing HON-225.
