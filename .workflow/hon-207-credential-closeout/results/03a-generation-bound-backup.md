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

## Real Local Artifact

The latest ignored synthetic run used a private temporary Wrangler config next
to its `.wrangler/state`, initialized real local D1 and R2 sentinels, and ran an
executed backup through the public CLI.

| Evidence                           | Readback                                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| Backup manifest SHA-256            | `121487bf3381491f9da76a44ccda0b6d23d364fc90a82296ff192229fd8d2a2a` |
| Lifecycle manifest SHA-256         | `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` |
| Derived source-state SHA-256       | `36656911b1e60063c40722c69fc2cc6aff1c88fae136e5345dd4c7d556405b85` |
| Derived generation-binding SHA-256 | `9f1b3310acdd0aa3ff9ecc25574b696bd9d9ce8799cca184509449b03c1512af` |
| D1 SQL SHA-256                     | `f9c072e48473c25ce9bf476661757f3a8662df4b2bc12d6ca06a6d932bb4c2e6` |
| R2 object count                    | 1                                                                  |
| R2 body SHA-256                    | `077d89133030adcc7d4adc367f9bae74b5387bbae4657b0639c9e5b84bdda7d4` |
| Stdout JSON                        | parsed successfully; executed                                      |
| Inventory validation state         | removed                                                            |
| Remote resources                   | none                                                               |

The repeated `f` generation digest is an explicit synthetic test value, not a
real credential or production manifest.

## Verification

```text
backup CLI focused: 35 passed
backup + scheduled workflow impact: 39 passed
backup + credential lifecycle combined: 53 passed
real local D1/R2 source export: passed
remote / ambient / split / omitted-R2 / dry-run / reused-output bound exports: rejected before spawn
concurrent same-output bound exports: exactly one coherent success; competitor rejected before spawn
incomplete D1-referenced R2 inventory: rejected after D1 export, before R2 get or manifest write
verified-empty D1 attachment set and explicit inventory: passed
generation-bound output claim: removed on success and handled failure
temporary D1 inventory-validation persistence: removed on success and failure
same source and lifecycle digest: stable derived binding
changed D1 source: different binding; old expectation rejected before spawn
manifest/history mismatch Wrangler spawns: 0
full suite: 99 files, 1,285 tests passed
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
