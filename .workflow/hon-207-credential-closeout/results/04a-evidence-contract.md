# EVIDENCE-1A: Credential Evidence Contract

Status: completed, merged, verified on main, and archived

Linear issue: HON-227

## Delivered Contract

- `compat/credential-evidence.schema.json` defines a closed structural schema.
- `compat/credential-evidence.json` registers exactly 11 credential operations
  against five ordered evidence levels and eight tracked artifacts.
- `scripts/honowarden-credential-evidence.mjs` enforces the semantic contract
  and emits a bounded count-and-limitations report.
- `pnpm credential:evidence:verify` is the repository verification entrypoint.

The canonical sources are pinned to program base
`a68ec0ccf0c5379ce228dce93f4f8eef05f6d6f3`, CLI
`cli-v2026.6.0@e6293ff2bc85123e9baaa998cf1543030ec5d9f0`, and browser
`browser-v2026.6.1@723c075bf8b9f45c901e56195be8e94e43ed75a2`, including the
approved CLI and extension asset SHA-256 values.

## Invariants

- Execution level and final evidence level are separate. API-driven mutations
  with official-client readback remain explicit API executions.
- A lower-level artifact cannot satisfy a higher-level claim.
- Official-client claims require canonical pinned client metadata and an exact
  `local_official_client` artifact.
- Staging or production claims require a semantically valid UTC timestamp and
  matching deployment reference and timestamp markers in the same-level
  tracked artifact. This packet publishes no staging or production claim.
- Artifact paths must be canonical, tracked, symlink-free regular files whose
  resolved path remains inside the repository.
- Every artifact is bound to an independently pinned SHA-256 digest; preserving
  selected markers while changing any other artifact content fails closed.
- Every digest-bound artifact has an explicit `text eol=lf` fresh-checkout
  contract. Verification canonicalizes only CRLF to LF before hashing so an
  existing `core.autocrlf=true` checkout remains equivalent without accepting
  other byte or line-ending drift.
- Unknown or duplicate operations, claim IDs, client sources, artifact
  bindings, fields, limitations, and marker values fail closed.
- Validation errors retain structural coordinates without reflecting rejected
  registry values, and CLI failure output is one fixed bounded line.

## TDD Readback

The initial focused test failed because the verifier module did not exist. A
second red phase proved that the pre-hardening contract accepted dot-component
schema paths, impossible calendar timestamps, and unbound live-environment
metadata. Review-driven red phases then proved that self-asserted provenance,
claim-agnostic client operations, preserved-marker content drift, and missing
marker error disclosure were accepted. A final red phase proved that standard
`JSON.parse` materialization accepted duplicate object keys, including
escape-equivalent nested names. The fourth review red phase proved that unknown
operation and object-field values reached verifier errors and CLI stderr, and
that digest-bound checkout bytes had no cross-platform LF contract. The focused
suite now passes all 36 positive and negative cases, including those exact
adversarial mutations plus schema-only level, tuple, and claim-identity gates.

## Verification

| Gate                      | Readback                                      |
| ------------------------- | --------------------------------------------- |
| Evidence contract         | 36/36 tests passed                            |
| Compatibility impact      | 141/141 tests across 4 files passed           |
| Full suite                | 1,371/1,371 tests across 103 files passed     |
| HON-222 plan unit         | 4/4 Node tests passed                         |
| Linear repo/live equality | HON-222 plus 3 children, 2 relations, 0 error |
| TypeScript                | `tsc --noEmit` passed                         |
| ESLint                    | full repository passed                        |
| Prettier                  | full repository passed                        |
| Brand scan                | passed                                        |
| Dependency audit          | 0 known vulnerabilities                       |
| Frozen offline install    | passed                                        |
| Release gate              | ready, 11 pass / 0 manual / 0 block           |
| Alpha completion audit    | complete                                      |
| `git diff --check`        | passed                                        |

Artifact SHA-256 values at source-ready state:

- registry:
  `53192962c66ccd1714d3a9ce6d878d12ed91b31f1d765caef1af4e127e15a169`
- schema:
  `1640608cb08c4fdac43d6ac94bfdc4b06e5af6fe10e6c1473a6d459a3f02c32f`
- verifier:
  `7beb3a48f96903f7c8168c7cf84388b4f18d013aa778676b6e4311bcecf1e106`
- lockfile:
  `fc40f82c98925b8bee037d291cfb5093c0361e78fcfb0cbbd52d0359c6b69b2b`

The generic dynamic-workflow completion verifier still reports only the
expected missing `final-report.md`. The parent workflow remains intentionally
in progress through EVIDENCE-1B, EVIDENCE-1C, and CLOSE-1; adding a final report
here would falsely mark the larger workflow complete.

## Linear Readback

- HON-222 and HON-227: In Progress and non-archived.
- HON-228 and HON-229: Todo and non-archived.
- HON-227 blocks HON-228; HON-228 blocks HON-229.
- Team-wide WIP was normalized from 29 stale `In Progress` entries to exactly
  HON-222 and HON-227; the other 27 entries were moved reversibly to Todo.
- Managed parent checkpoint:
  `0aead33f-61bd-4223-afd3-cb1c4a382008`.
- Repo-rendered descriptions and checkpoint matched live Linear byte-for-byte.

## Initial Standard Review Remediation

Native Codex standard review inspected exact head
`360a1351ca87aac0c51aec4746f5ada3fed1b4e3` in session
`019f881f-a592-7092-8d86-49f1f1cd039c` and returned one P1 plus three P2
findings:

- a local artifact could self-label as official-client or staging evidence;
- a different 40-character artifact marker could replace the true source
  generation;
- a claim could reduce official-client proof to an unrelated operation such as
  `lock`;
- the CLI limitation was fixed text and would contradict a future valid live
  claim.

All four cases were reproduced as passing mutations against the reviewed head.
The remediation adds an independently pinned operation-level provenance
catalog, canonical full-claim digests, exact client-operation sets, and a live
limitation derived from validated claim levels. The same mutations now fail in
focused tests.

## Second Standard Review Remediation

Native Codex standard review inspected exact head
`07939e40f24e08214ee6960b0eafa6a9b1ad605d` in session
`019f882f-5a7c-7030-934d-77472bcbc399` and returned two P1 findings:

- tracked evidence content could be changed while preserving the selected
  required markers;
- a missing marker value was copied into the thrown error and CLI stderr.

Both findings were reproduced against the reviewed head before remediation.
Artifacts now carry schema-required content digests checked against an
independent path-to-digest catalog and the actual tracked file bytes. Missing
marker errors now identify only the artifact binding, never the marker value.
Focused regressions prove both the content-drift rejection and non-disclosure.

## Third Standard Review Remediation

Native Codex standard review inspected exact head
`580cfa9a40cd9e183c29d28314e7a090fe689240` in session
`019f8843-fd62-7883-9559-7bb4915b113e` and returned one P2 finding: duplicate
JSON object keys were accepted because `JSON.parse` silently kept the last
value.

The finding was reproduced for both a top-level duplicate and nested keys that
become equal only after JSON escape decoding. Loading now uses the repository's
existing `jsonc-parser` dependency to build a strict JSON syntax tree before
materialization, compares decoded keys independently within every object, and
emits a fixed error that does not disclose the key. Both mutations now fail.

## Fourth Standard Review Remediation

Native Codex standard review inspected exact head
`6da6d3a7eabf0e2cbf82e7200fa528c458009a5c` in session
`019f884f-1983-7b40-b1fa-07a2294f0971` and returned one P1 plus one P2
finding:

- unknown registry field names, operations, duplicate identifiers, and related
  rejected values could be reflected through verifier errors into CLI stderr;
- artifact digests hashed decoded checkout text without pinning line endings,
  so a standard CRLF checkout could reject canonical repository content.

Both findings were reproduced before remediation. Internal errors now expose
only fixed diagnostics and structural array coordinates, while the CLI emits a
single fixed failure line regardless of the underlying exception. The verifier
hashes actual file bytes, and `.gitattributes` pins `text eol=lf` for every one
of the eight independently digest-bound artifacts. Regressions cover unknown
operations, unknown object fields, end-to-end CLI stderr non-disclosure, and
complete LF-attribute coverage. Git `check-attr` confirms `eol=lf` for all eight
paths in fresh checkouts.

## Fifth Standard Review Remediation

Native Codex standard review inspected exact head
`a20a22d922a633e6d8e0bf66e5dbf61689e3f426` in session
`019f8869-93f2-7ca3-8e98-550a5f5e6f6f` and returned one P2 finding: adding
`eol=lf` does not retroactively rewrite unchanged files in an existing
`core.autocrlf=true` checkout, so seven digest-bound artifacts could remain
CRLF and fail verification after a normal base-to-head update.

The reviewer reproduced the failure in an isolated clone. A focused red test
then converted all eight artifact worktree copies to CRLF and reproduced the
same digest mismatch. Artifact verification now canonicalizes CRLF pairs to LF
at the byte level before hashing and marker checks, rejects lone CR line endings,
and still rejects appended content in the same CRLF fixture. The regression now
passes without relying on Git to rewrite an existing worktree.

## Sixth Standard Review

Native Codex standard review inspected exact head
`b6c40ef912a3f6309168db2cca96f4f01d9b55a8` in session
`019f8878-a9ce-7610-82a5-5ceb4b7d74a5` and returned no P0-P3 findings. The
reviewer independently passed the 34-test pre-remediation focused suite, the
four HON-222 plan tests, verifier, Git attribute readback, and diff check. An
isolated exact-commit checkout with `core.autocrlf=true` also retained CRLF in
seven existing artifacts while the remediated verifier passed, proving the
line-ending fix against the original failure mode.

## Initial Five-Axis Review And Remediation

Independent Opus review inspected exact head
`b6c40ef912a3f6309168db2cca96f4f01d9b55a8` in read-only session
`95d86cad-7427-425e-b094-4906d34f3e15`. It approved all five axes with no
P0-P2 finding and one non-blocking P3: the runtime verifier enforced
level-specific `clientEvidence`, `environmentEvidence`, execution-level, and
source-kind constraints that the JSON Schema did not express on its own.

The finding was reproduced with Ajv 2020: a `local_api` claim carrying client
evidence passed the schema before remediation. The schema now requires client
evidence only for `local_official_client`, fixes that claim to `local_api`
execution, requires matching environment evidence only for staging/production,
and limits `reviewed_head` source generations to live claims. Seven independent
mutations now fail at the schema boundary while the canonical registry passes.

Ajv is test-only. The first selected 8.17.1 release was rejected before commit
because the required low-level audit found `GHSA-2g4f-4pwh-qvx6`; patched Ajv
8.20.0 is installed and `pnpm audit --audit-level low` reports no known
vulnerabilities. The lockfile evidence and release gate were updated, after
which the full 1,370-test suite and all quality gates passed.

That remediation proceeded to the seventh standard review below.

## Seventh Standard Review And Remediation

Native Codex standard review inspected exact head
`5635aff82c8bbfdeda6094a42bbaf1e75a603159` in session
`019f88c1-f9c1-7df0-b861-958abba8c859` and returned two P2 findings. Although
the runtime verifier rejected both classes, a schema-only Ajv consumer could:

- claim an execution level above its evidence level; and
- back an official-client or live claim only with lower-level artifacts, or
  attach an artifact above the claim level.

Both findings were reproduced against the reviewed head before remediation.
The schema now encodes the complete five-level execution ordering, requires at
least one artifact at exactly the claim level, and rejects every artifact above
that level. The focused schema test checks all 25 execution/evidence pairs,
including the stricter official-client execution boundary, plus exact-artifact
absence and higher-artifact rejection at every applicable level.

The first serial full-suite remediation run passed 1,368 tests and timed out in
two unrelated real-Wrangler lifecycle tests. Each timed-out test passed alone in
19 and 17 seconds, no residual Wrangler or workerd process remained, and the
unchanged serial suite then passed all 1,370 tests across 103 files in 148
seconds. TypeScript, ESLint, Prettier, brand scan, dependency audit, frozen
offline install, release gate, alpha completion audit, verifier, and HON-222
plan tests also passed after the remediation.

That remediation proceeded to the exact-head reviews below.

## Exact D7B Five-Axis Review

Independent Opus review inspected exact head
`d7b7d93077d1a3ff5800b271166eaded4dc3e36f` in read-only session
`11350ece-1202-46ad-9b38-b58502c48bfc`. It returned no actionable P0-P3,
graded the five axes A, A, A, A-, and A-, and approved. Its non-blocking residual
risks were direct tests for currently redundant deep symlink guards, a positive
live-claim path when live evidence is eventually introduced, and maintenance
tooling for intentionally manual digest-pin updates.

## Eighth Standard Review And Remediation

Native Codex standard review independently inspected the same exact head in
session `019f88fa-3abe-79a2-b0bd-c4a877d2f5a5` and returned two P2 findings.
A schema-only Ajv consumer could accept:

- five duplicate or reordered evidence-level entries with incorrect rank and
  scope values; and
- duplicate or reordered claims that omitted required credential operations.

All seven tuple, rank, scope, operation, claim-ID, and order mutations were
reproduced as accepted before remediation. The schema now pins the five exact
`{id, rank, scope}` tuples and all 11 canonical `{id, operation}` identities in
order with strict Draft 2020-12 `prefixItems`; tuple-local item counts and
`items: false` make both sequences closed. The canonical registry passes while
all seven mutations fail. Focused tests pass 36/36, compatibility passes
141/141, and the serial full suite passes 1,371/1,371 across 103 files. All
static, dependency, release, verifier, and HON-222 plan gates also pass.

## Exact ED59 Implementation Reviews

Native Codex standard review inspected exact implementation head
`ed59a880b469d1efa03e4d654a61d48fa86bcc5b`, tree
`3f44fd1536170dcef9e204f2ad4a2f5e7dd6834d`, in session
`019f892d-b7f1-7de2-83ac-7ac4b7f5a4e5`. It returned no actionable P0-P3
findings. The reviewer independently passed the 36 focused tests, four HON-222
plan tests, direct schema and verifier execution, TypeScript, ESLint, and diff
checks. Its attempted pnpm commands hit only the already isolated local
registry-signature/network failure; direct local binaries passed.

Independent Opus five-axis review inspected the same exact clean head in
read-only session `b06d50a9-5787-4f93-a55c-b588b8e021a7`. It returned no
actionable P0-P3 finding, graded problem framing A, diagnosis A, solution design
A, architecture and operations A-, and implementation craft A, then approved.
Its non-blocking residual risks were schema-only client-operation/surface
strictness for noncanonical registries, coordinated maintenance of in-module
provenance pins, and direct positive coverage when dormant live claims are
introduced. None changes the canonical registry or this local-only packet.

Both reviewers re-read the exact head and clean tracked worktree before their
verdicts. This review record is the only post-review source change; its exact
evidence-only commit must pass a final no-change review before publication.

The review process also reported unrelated Figma/MCP authentication and local
pnpm registry-signature/network friction. Direct Node/Vitest execution and the
host pnpm gates passed; no source failure was attributed to those environment
messages.

## Publication And Linear Closeout

The final evidence head
`1fe26a78a9f4f550e3d4cc868c5e7272e51d8cb2` passed native Codex standard
review in session `019f893b-1273-7d03-b6e4-b4f01f70b086` and independent
Opus five-axis review in session `0af051cd-6e40-4c4a-8c8e-818255ebd9b0`
with no actionable P0-P3 finding. PR #115 head CI run `29910422454` passed.

PR #115 was admin squash-merged as
`5b67fbdcf6d32942e5786f4cc49684c479778de8`. The reviewed branch tree and
squash tree both equal `0297ca848869817cbec3e8f077cd61d313faf239`.
Merged-main CI run `29910713312` passed on that exact commit, with zero
unresolved review threads. HON-227 moved to Done and was archived at
`2026-07-22T10:11:52.647Z`; only then was HON-228 moved to In Progress.

No deployment, remote mutation, real credential, production or staging
activation, destructive operation, paid action, browser-profile access, or
third-party contact was performed.
