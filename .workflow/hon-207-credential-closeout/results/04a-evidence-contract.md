# EVIDENCE-1A: Credential Evidence Contract

Status: five-axis remediation source-ready; final exact-head reviews and publication pending

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
suite now passes all 35 positive and negative cases, including those exact
adversarial mutations and a schema-only level-consistency gate.

## Verification

| Gate                      | Readback                                      |
| ------------------------- | --------------------------------------------- |
| Evidence contract         | 35/35 tests passed                            |
| Compatibility impact      | 140/140 tests across 4 files passed           |
| Full suite                | 1,370/1,370 tests across 103 files passed     |
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
  `ed9b70078aeca9c907ef08061a2b8989e90c5afc6243bad4fe42d51a23eab001`
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

Final exact-head standard and five-axis review of the remediation commit remain
pending.

The review process also reported unrelated Figma/MCP authentication and local
pnpm registry-signature/network friction. Direct Node/Vitest execution and the
host pnpm gates passed; no source failure was attributed to those environment
messages.

## Remaining Publication Gate

Exact-head standard and five-axis review of the remediation commit, PR/head CI,
zero unresolved threads, squash tree equality, merged-main CI, and HON-227
Done/archive remain. EVIDENCE-1B must not start before that closeout.

No deployment, remote mutation, real credential, production or staging
activation, destructive operation, paid action, browser-profile access, or
third-party contact was performed.
