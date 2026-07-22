# EVIDENCE-1A: Credential Evidence Contract

Status: implementation source-ready; exact-head review and publication pending

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
- Unknown or duplicate operations, claim IDs, client sources, artifact
  bindings, fields, limitations, and marker values fail closed.
- CLI output contains no artifact content or required marker values.

## TDD Readback

The initial focused test failed because the verifier module did not exist. A
second red phase proved that the pre-hardening contract accepted dot-component
schema paths, impossible calendar timestamps, and unbound live-environment
metadata. The final focused suite passes all 19 positive and negative cases.

## Verification

| Gate                      | Readback                                      |
| ------------------------- | --------------------------------------------- |
| Evidence contract         | 19/19 tests passed                            |
| Compatibility impact      | 124/124 tests across 4 files passed           |
| Full suite                | 1,354/1,354 tests across 103 files passed     |
| HON-222 plan unit         | 4/4 Node tests passed                         |
| Linear repo/live equality | HON-222 plus 3 children, 2 relations, 0 error |
| TypeScript                | `tsc --noEmit` passed                         |
| ESLint                    | full repository passed                        |
| Prettier                  | full repository passed                        |
| Brand scan                | passed                                        |
| Dependency audit          | 0 known vulnerabilities                       |
| Frozen offline install    | passed                                        |
| Release gate              | ready, 11 pass / 0 manual / 0 block           |
| `git diff --check`        | passed                                        |

Artifact SHA-256 values at source-ready state:

- registry:
  `1d55ae4f26f8b78fcb0f821960da44984cf12b732772ef392ab4bf55563503a5`
- schema:
  `f3f89db4643b7f5ef7b61e5567422d7d8f7e96027f0db5bbe5e21aff50dd7f2c`
- verifier:
  `97e50c14f782e6cf359a84d8f567de00fb80d5e60783b901a353ebef2e739e91`

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

## Remaining Publication Gate

Exact-head standard review, independent five-axis review, PR/head CI, zero
unresolved threads, squash tree equality, merged-main CI, and HON-227
Done/archive remain. EVIDENCE-1B must not start before that closeout.

No deployment, remote mutation, real credential, production or staging
activation, destructive operation, paid action, browser-profile access, or
third-party contact was performed.
