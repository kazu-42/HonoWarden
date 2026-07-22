# EVIDENCE-1A: Credential Evidence Contract

Status: second-review remediation source-ready; final exact-head review and publication pending

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
- Unknown or duplicate operations, claim IDs, client sources, artifact
  bindings, fields, limitations, and marker values fail closed.
- CLI output contains no artifact content or required marker values.

## TDD Readback

The initial focused test failed because the verifier module did not exist. A
second red phase proved that the pre-hardening contract accepted dot-component
schema paths, impossible calendar timestamps, and unbound live-environment
metadata. Review-driven red phases then proved that self-asserted provenance,
claim-agnostic client operations, preserved-marker content drift, and missing
marker error disclosure were accepted. The focused suite now passes all 27
positive and negative cases, including those exact adversarial mutations.

## Verification

| Gate                      | Readback                                      |
| ------------------------- | --------------------------------------------- |
| Evidence contract         | 27/27 tests passed                            |
| Compatibility impact      | 132/132 tests across 4 files passed           |
| Full suite                | 1,362/1,362 tests across 103 files passed     |
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
  `1de0df8517786d20c28f6429e24716c91044cb5996b08b337282308efad74534`
- verifier:
  `dfe230c714ab5ef49c3b17999b26733d81506c7054e401c67a06cfea7dc394fd`

The generic dynamic-workflow completion verifier still reports only the
expected missing `final-report.md`. The parent workflow remains intentionally
in progress through EVIDENCE-1B, EVIDENCE-1C, and CLOSE-1; adding a final report
here would falsely mark the larger workflow complete.

## Linear Readback

- HON-222 and HON-227: In Progress and non-archived.
- HON-228 and HON-229: Todo and non-archived.
- HON-227 blocks HON-228; HON-228 blocks HON-229.
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
Final exact-head standard and five-axis review remain pending.

The review process also reported unrelated Figma/MCP authentication and local
pnpm registry-signature/network friction. Direct Node/Vitest execution and the
host pnpm gates passed; no source failure was attributed to those environment
messages.

## Remaining Publication Gate

Exact-head standard review, independent five-axis review, PR/head CI, zero
unresolved threads, squash tree equality, merged-main CI, and HON-227
Done/archive remain. EVIDENCE-1B must not start before that closeout.

No deployment, remote mutation, real credential, production or staging
activation, destructive operation, paid action, browser-profile access, or
third-party contact was performed.
