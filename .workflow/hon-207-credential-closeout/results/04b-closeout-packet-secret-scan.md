# EVIDENCE-1B: Canonical Closeout Packet And Secret Scan

Status: implementation in progress; broad gates and exact-head reviews pending

Linear issue: HON-228

## Delivered Contract

- `compat/credential-closeout-packet.json` is the canonical generated packet.
- `scripts/honowarden-credential-closeout.mjs` generates, scans, writes, and
  verifies the packet.
- `pnpm credential:closeout:verify` verifies committed canonical bytes;
  `pnpm credential:closeout:write` publishes through a same-directory atomic
  rename only after all inputs and generated output pass.
- `test/compat/credential-closeout.test.ts` owns deterministic-byte, closed
  shape, source binding, path safety, secret-class, and CLI non-disclosure
  regressions.

The packet contains only exact claim IDs, verified statuses, source pins,
execution and evidence levels, client source IDs, counts, repository-relative
artifact paths, limitations, and SHA-256 digests. It excludes claim assertions,
required markers, artifact contents, timestamps, environment-derived paths,
and secret material.

## Invariants

- The registry and schema are independently pinned to SHA-256 values
  `53192962c66ccd1714d3a9ce6d878d12ed91b31f1d765caef1af4e127e15a169`
  and `1640608cb08c4fdac43d6ac94bfdc4b06e5af6fe10e6c1473a6d459a3f02c32f`.
- The exact ordered set is 11 claim IDs, five evidence levels, eight unique
  artifacts, and 20 claim-to-artifact bindings.
- HON-227 validation runs before packet construction, so stale provenance,
  digest, marker, level, client, tracked-path, and source-generation input
  fails before publication.
- Source, artifact, and packet paths must be canonical, repository-contained,
  symlink-free regular files. Missing, untracked, extra, non-regular,
  path-escaping, oversized, invalid UTF-8, lone-CR, and digest-drift inputs fail
  closed.
- The scanner rejects secret-bearing JSON/schema fields, assignments, URL or
  cookie pairs, Authorization credentials, JWTs, vault ciphertext, private-key
  blocks, personal identities, provider payloads, and profile material.
- Scanner and CLI failures never reflect rejected values. The CLI failure is
  one fixed line.
- CRLF checkout bytes canonicalize to LF; generated output is always LF and
  any other formatting or data drift is rejected as noncanonical.

## TDD Readback

The first focused run failed because the closeout module did not exist. The
initial implementation then passed 32 of 34 tests; the two failures isolated a
macOS `/var` to `/private/var` realpath alias in temporary roots. Requested
paths are now mapped from the requested root to its canonical root before the
same containment and symlink checks run. A later red phase proved that a safe
outer `Set-Cookie:` or metadata field could consume a regex match and hide an
inner token/password pair. Pair scanning now uses bounded overlapping matches,
so outer metadata cannot mask nested secret-bearing assignments. The focused
suite passes all 39 tests.

Positive leak fixtures cover passwords, raw access and refresh tokens, wrapped
and unwrapped keys, encrypted item bodies, identity payloads, provider
payloads, profiles, secret-like schema fields, Authorization credentials,
JWTs, vault ciphertext, private-key blocks, and personal email identities.
Approved digests, versions, counts, enums, source refs, repository paths,
limitation text, empty secret counts, and reserved example identities remain
accepted.

## Current Verification

| Gate                        | Readback                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Focused generator/scanner   | 39/39 passed                                                                             |
| Compatibility impact        | 180/180 across 5 files passed                                                            |
| Full suite                  | 1,410/1,410 across 104 files passed serially                                             |
| HON-222 plan/state/readback | 5/5 Node tests passed; renderer/live comment SHA-256 equal                               |
| Canonical verifier          | 11 claims, 8 artifacts, 20 bindings passed                                               |
| Canonical packet            | 14,398 bytes; SHA-256 `7e1501caa7db4f38957788b97c4685602ebd7b3f54e38429ab840f9905b3be58` |
| Evidence levels             | fixture/local API/local official client present; staging/production 0                    |
| TypeScript                  | `tsc --noEmit` passed                                                                    |
| ESLint                      | full repository passed                                                                   |
| Prettier                    | full repository passed; generated packet has verifier-owned bytes                        |
| Brand scan                  | passed                                                                                   |
| Dependency audit            | 0 known vulnerabilities                                                                  |
| Release gate                | ready, 11 pass / 0 manual / 0 block                                                      |
| Alpha completion audit      | complete                                                                                 |
| `git diff --check`          | passed                                                                                   |

## Remaining Gates

Exact-head standard review, independent five-axis review, PR/head CI, zero
unresolved threads, squash tree equality, merged-main CI, and Linear
Done/archive remain required before HON-229 starts. The parent dynamic-workflow
verifier remains intentionally incomplete only because `final-report.md` is
reserved for EVIDENCE-1C and CLOSE-1 completion.

No deployment, remote mutation, real credential, production or staging
activation, destructive operation, paid action, normal browser profile, or
third-party contact is part of this packet.
