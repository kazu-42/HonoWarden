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
- A bound output path must be missing or empty. Reusing a previous output fails
  before spawn, preserving the old artifact and preventing a failed replacement
  from leaving an old manifest beside partially overwritten files.
- The bound manifest is written only after every export command succeeds and
  all D1/R2 checksums have been derived. A failed bound export leaves no new
  manifest that can be mistaken for a complete recovery artifact.
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

## Real Local Artifact

The latest ignored synthetic run used a private temporary Wrangler config next
to its `.wrangler/state`, initialized real local D1 and R2 sentinels, and ran an
executed backup through the public CLI.

| Evidence                           | Readback                                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| Backup manifest SHA-256            | `7a256fb498e6f070ecf3c53ed820805b05ce0346350fbe335d4cd626cad17afb` |
| Lifecycle manifest SHA-256         | `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` |
| Derived source-state SHA-256       | `f5609ee50f79b4cae682b7ba1141a1f2f5175b06bae814991b435e126afdaee8` |
| Derived generation-binding SHA-256 | `1c07fcc7a7f5b1ae4fba836bd573f6eaa981a51f9f6012cf518d411f323c63bc` |
| D1 SQL SHA-256                     | `ad6ad64216220f56abe6a32f6a8911e64c408f45f866d7d8caf11d1b22abeb86` |
| R2 object count                    | 1                                                                  |
| R2 body SHA-256                    | `b1f1eccf48844dd5943eb8882bc88b657d19e9063d8fd69bb310daece4b7833b` |
| Stdout JSON                        | parsed successfully; executed                                      |
| Remote resources                   | none                                                               |

The repeated `f` generation digest is an explicit synthetic test value, not a
real credential or production manifest.

## Verification

```text
backup CLI focused: 32 passed
backup + scheduled workflow impact: 36 passed
backup + credential lifecycle combined: 50 passed
real local D1/R2 source export: passed
remote / ambient / split / omitted-R2 / dry-run / reused-output bound exports: rejected before spawn
same source and lifecycle digest: stable derived binding
changed D1 source: different binding; old expectation rejected before spawn
manifest/history mismatch Wrangler spawns: 0
full suite: 99 files, 1,282 tests passed
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
