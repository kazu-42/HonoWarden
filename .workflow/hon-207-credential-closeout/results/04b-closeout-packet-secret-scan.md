# EVIDENCE-1B: Canonical Closeout Packet And Secret Scan

Status: review remediation complete; fresh exact-head reviews pending

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
so outer metadata cannot mask nested secret-bearing assignments.

The first exact implementation-head reviews at `e97fc52` then identified
concrete scanner gaps. A read-only Opus standard review in session
`7fd0aabe-9389-48d3-9378-8a31e15b094f` found one P3: a secret pair immediately
after `|` was not considered. A separate Opus five-axis review in session
`fcfb6505-6218-47b3-8728-e22b558053f8` found one P2 plus P3 hardening gaps:
`newMasterPasswordHash` and compact field names, EncString types 3-7, direct
size/UTF-8/digest tests, and an unbounded repeated-delimiter scan. Native Codex
session `019f896f-24f2-74a1-a503-a456d741d920` reached the usage limit before
inspection and produced no verdict.

The first remediation red run passed 39 of 49 tests and reproduced all nine
scanner examples plus a byte-order-mark drift that violated exact packet bytes.
After that fix, an expanded `keyHash` fixture produced the only failure in a
59-test run. The final implementation:

- detects high-risk password, token, secret, credential, and key field
  sequences without treating `credential proof: passed`, key digests, or
  colon-delimited package scripts as secrets;
- detects compact API/access/auth token forms and all repository-supported
  EncString types 0-7 with their exact one-, two-, or three-part shapes;
- preserves a UTF-8 BOM during decode so byte-exact verification rejects it;
- bounds each overlapping value prefix to 256 characters while a maximum-sized
  delimiter-heavy regression proves a trailing secret is still found; and
- directly pins oversized, invalid UTF-8, and registry source-digest failures.

The first remediation commit `ed0f3a5` then received two fresh reviews. Standard
Opus session `b0b1a188-09ec-47a7-9e6d-08fb1dc5cc92` approved with zero
actionable P0-P3, while noting that type 0 was conservatively accepted as both a
one- and two-part EncString. Five-axis Opus session
`fa64dc9a-1bd5-4855-9df0-15998e2451a0` approved with three actionable P3
hardening findings: secret-material suffixes, non-Bearer/Basic Authorization
schemes, and bracket-wrapped assignments. The second remediation red run passed
64 of 77 tests and reproduced all 12 false negatives plus the type 0
false-positive. The implementation now also:

- detects plaintext, raw, clear, material, blob, and bearer suffixes for both
  segmented and compact high-risk field names;
- rejects every non-sentinel Authorization value without maintaining a scheme
  allowlist;
- recognizes `[` as an inline assignment boundary; and
- accepts only the repository's exact EncString part count for each type, with
  malformed one-, two-, and three-part controls pinned as safe metadata.

A final self-review reproduced two false positives for scheme-prefixed redacted
Authorization values in a 77-of-79 red run. Authorization sentinel handling now
accepts either a direct sentinel or an arbitrary scheme followed only by a
sentinel, without accepting a real credential value. The focused suite now
passes all 79 tests.

Positive leak fixtures cover passwords, password hashes and plaintext variants,
raw/compact access and refresh tokens, key/secret hashes and material, token
signatures and bearer fields, wrapped and unwrapped keys, encrypted item bodies,
identity payloads, provider payloads, profiles, secret-like schema fields,
Authorization credentials across schemes, bracket-wrapped assignments, JWTs,
EncString types 0-7, private-key blocks, and personal email identities. Approved
digests, versions, counts, enums, source refs, repository paths, limitation
text, empty secret counts, redacted Authorization, malformed EncString shapes,
verification markers, package scripts, and reserved example identities remain
accepted.

## Current Verification

| Gate                        | Readback                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Focused generator/scanner   | 79/79 passed                                                                             |
| Compatibility impact        | 220/220 across 5 files passed                                                            |
| Full suite                  | 1,450/1,450 across 104 files passed serially                                             |
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

Fresh exact-head standard and independent five-axis reviews of the remediation,
PR/head CI, zero unresolved threads, squash tree equality, merged-main CI, and
Linear Done/archive remain required before HON-229 starts. The parent
dynamic-workflow verifier remains intentionally incomplete only because
`final-report.md` is reserved for EVIDENCE-1C and CLOSE-1 completion.

No deployment, remote mutation, real credential, production or staging
activation, destructive operation, paid action, normal browser profile, or
third-party contact is part of this packet.
