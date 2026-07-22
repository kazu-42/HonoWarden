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
passed all 79 tests at implementation head `d72a336`.

That head received two further independent reviews. Standard Opus session
`acbe4b82-46e7-4689-9094-b4e19a8e3d67` approved with zero actionable P0-P3 and
independently exercised 36 scanner probes, all 79 focused tests, canonical
verification, packet hashes, and atomic output behavior. Five-axis Opus session
`ca81f202-67b0-4c53-94ac-69e7e875e579` resumed after a transient `ENOTFOUND`
API failure and approved the overall change, but identified one actionable P2
and two P3 hardening findings:

- the email regex took quadratic time on a dotted maximum-size input, while
  high-risk field classification copied every remaining suffix with
  `slice(index + 1)`;
- recovery secret fields such as seed phrases, mnemonics, recovery codes, TOTP
  seeds, and salts were not classified; and
- an empty Bearer Authorization header and a status-annotated redaction were
  conservatively rejected.

The third remediation red run passed 81 of 90 tests and reproduced all nine
behavioral and performance failures. The scanner now:

- walks literal `@` positions and their adjacent local/domain runs once, so
  at-free and multi-address input is linear instead of repeatedly backtracking;
- classifies high-risk suffix sequences with one reverse pass and no suffix
  array copies;
- recognizes exact singular/plural recovery-secret field families with the
  existing allowed metadata suffixes; and
- permits only known empty Authorization schemes or an exact redaction sentinel
  followed by one allowlisted lifecycle annotation, while raw or trailing
  credentials remain rejected.

On the same machine, the 80 KiB dotted probe fell from about 1,149 ms to 1 ms
and the 900 KiB secret-field probe fell from about 655 ms to 13 ms. The tests
retain a conservative 250 ms bound at both sizes. Focused, compatibility, and
full serial suites now pass 92, 233, and 1,463 tests respectively.

Native Codex exact-head review session
`019f8a5a-849f-7e03-947d-f9fc04c8088b` then inspected commit `83194cc` and
returned one P1 plus three P2 findings. Direct probes proved that Markdown
emphasis/table labels could hide a password, credential values equal to status
words were treated as empty, non-ASCII account identities were ignored, and
CGI-style `HTTP_AUTHORIZATION` variables bypassed the header scan. A separate
Opus five-axis attempt in session `57edb51b-95bd-4cc1-9317-ec7a23979d29`
performed 16 read-only turns but reached its weekly limit before returning a
verdict, so it is recorded as unavailable rather than approval evidence.

The fourth remediation red run passed 96 of 112 tests and reproduced all 16
review failures. Two generalized Markdown controls then produced a 112-of-114
red run for whitespace inside emphasis and a secret label in a later table
column. The implementation now:

- scans emphasized and HTML-emphasized labels plus every adjacent Markdown
  table cell, including headings and labels with internal whitespace;
- accepts only exact redaction placeholders for secret values and
  Authorization credentials, with two label-and-value-bound non-secret summary
  exceptions for existing count evidence;
- rejects Unicode identity candidates around `@` while preserving pinned
  ASCII source references and approved public/reserved addresses;
- recognizes header names and CGI-style Authorization variables with one or
  more underscore prefixes; and
- preserves linear bounds for dotted, large-field, and 910 KiB Markdown-table
  inputs, each with a 250 ms regression ceiling.

One final self-review produced a 122-of-126 red run by joining Unicode,
punctuation, or domain-like suffixes to an otherwise allowlisted public address.
Identity matching now checks Unicode context before allowlisting and anchors the
entire ASCII candidate, while treating explicit Japanese punctuation as a text
boundary. Focused, compatibility, and full serial suites now pass 126, 267, and
1,497 tests respectively. The canonical packet remains 14,398 bytes with SHA-256
`7e1501caa7db4f38957788b97c4685602ebd7b3f54e38429ab840f9905b3be58`.

Native Codex exact-head review session
`019f8a7b-ad56-7923-b57c-498015d9b787` then inspected commit `70e9cc1` and
returned one P2 finding. The Unicode identity helper treated every adjacent `@`
as part of the same token and rescanned both sides for each candidate. A direct
probe grew from about 85 ms at 2,000 repetitions to 5.52 seconds at 16,000,
demonstrating quadratic behavior within an allowed input.

The fifth remediation red run passed 126 of 127 focused tests and took about
1.32 seconds for 8,192 repetitions against a 250 ms ceiling. `@` is now an
identity-token boundary, so candidate scans cannot cross into adjacent
candidates. The regression uses a 1,000,000-byte input and completes below the
same ceiling; a direct post-fix probe measured about 38.5 ms. Focused,
compatibility, and full serial suites now pass 127, 268, and 1,498 tests
respectively without changing the canonical packet.

Native Codex exact-head review session
`019f8a87-5411-7620-95d1-1853f5253937` then inspected commit `838bb7d` and
returned three P1 findings. Direct probes showed that URL userinfo could be
hidden behind an allowlisted public address, valid GFM tables without outer
pipes skipped field scanning, and Markdown-wrapped or table-formatted
Authorization labels bypassed the raw-header matcher.

The sixth remediation red run passed 132 of 138 focused tests and reproduced
all six representative fail-open inputs. URL authorities are now scanned before
identity allowlisting with the standard URL parser, including protocol-relative
and malformed URL-like inputs. Markdown pair classification now routes both
secret-like fields and Authorization labels through their strict value checks,
while a delimiter-row state machine scans outer-pipe-free GFM tables once.

An initial URL regex implementation caused the existing dotted-input performance
test to take about 2.17 seconds. It was replaced before commit with a monotonic
literal-`//` authority scan; a new near-limit repeated-separator regression and
the existing dotted, adjacent-`@`, large-field, and Markdown-table regressions
all remain below 250 ms. Focused, compatibility, and full serial suites now pass
141, 282, and 1,512 tests respectively without changing the canonical packet.

Native Codex exact-head review session
`019f8a94-7365-7a02-9792-ac31a195ff0e` then inspected commit `cd99f26` and
returned two P1 plus two P2 findings. Postfixed credential field names such as
`passwordOld` and `accessTokenCopy` were not classified, standalone provider
access tokens and authentication cookies were not scanned, packet verification
did not require the canonical output to be Git-tracked, and an oversized
generated packet was rejected only after replacing the previous valid file.
The reviewer's focused and static checks passed; its broad-suite attempt was
stopped by the external review environment after 310 seconds and is not counted
as repository failure or approval evidence.

The seventh remediation red run passed 146 of 155 focused tests and reproduced
all nine representative fail-open or mutation-order cases. The implementation
now:

- extends the existing reverse-pass field classifier with bounded credential
  qualifiers while preserving explicit metadata controls such as password
  policy and access-token count;
- rejects high-confidence GitHub and Slack token forms plus non-redacted values
  in known authentication cookies, while accepting non-authentication cookies
  and exact redaction sentinels;
- requires the canonical packet path in the tracked-path set before verify or
  write and keeps an existing packet byte-for-byte unchanged on rejection; and
- validates a generated packet against a bounded byte limit before creating a
  temporary file or executing the atomic rename.

Focused, compatibility, and full serial suites now pass 155, 296, and 1,526
tests respectively. The full suite completed across 104 files in 129.30 seconds.
The canonical packet remains 14,398 bytes with SHA-256
`7e1501caa7db4f38957788b97c4685602ebd7b3f54e38429ab840f9905b3be58`.

Native Codex exact-head review session
`019f8aac-6f2b-77f1-8828-663976d6a84d` then inspected commit `5bf3bf5` and
returned three P1 plus one P2 finding. Direct probes showed that unrecognized
structured suffixes such as `passwordInput` and `wrappedKeyData` remained
fail-open, separators inside Markdown emphasis were not classified correctly,
authentication cookies in Markdown lists or tables were missed, and dotless or
address-literal personal identities were accepted. The reviewer passed all 155
focused tests and five HON-222 plan tests. Its pnpm verifier attempt failed only
because its isolated environment could not fetch signed pnpm registry metadata;
the direct binaries and repository-controlled pnpm gates remained green.

The eighth remediation red run passed 159 of 168 focused tests and reproduced
the nine representative contract failures. The scanner now:

- treats high-risk words in structured identifiers as secret-bearing without
  relying on an exhaustive suffix list, while bounded JSON-scalar parsing
  permits only exact password-policy, access-token-count, credential-proof, and
  key-digest metadata forms;
- parses Markdown and HTML field separators on either side of the closing
  wrapper and keeps raw Authorization matching from reinterpreting a
  wrapper-owned pair;
- routes plain, list, emphasized, and table Cookie fields through one
  authentication-cookie value classifier with exact redaction controls; and
- rejects dotless and IPv4/IPv6 address-literal identities while preserving
  explicit public/reserved addresses, version-at-commit source references, and
  the canonical schema's source-reference regex.

A final self-review caught an Authorization bypass introduced by unconditional
wrapper stripping: raw values such as `**Bearer` or `_Bearer` could be mistaken
for an empty scheme. The final implementation skips raw-header duplication only
when the field itself has the matching Markdown or HTML wrapper, and direct
positive/negative controls cover raw, CGI, Markdown, and HTML variants.

Focused, compatibility, and full serial suites now pass 181, 322, and 1,552
tests respectively. The full suite completed across 104 files in 137.11 seconds.
All eight canonical artifacts pass independently, and the packet remains 14,398
bytes with SHA-256
`7e1501caa7db4f38957788b97c4685602ebd7b3f54e38429ab840f9905b3be58`.

Native Codex exact-head review session
`019f8ac1-9f8f-7ff2-a542-33c980c7d3ce` then inspected commit `11b2f82` and
returned two P1 plus one P2 findings. Direct probes showed that parenthesized
or bracketed qualifiers could hide otherwise secret-like labels, serialized
JSON or embedded prose could hide authentication Cookie headers, and
JSON-escaped or RFC quoted local-part identities bypassed the literal atom
scanner. The reviewer independently passed the focused suite, HON-222 plan
tests, typecheck, ESLint, Prettier, canonical verifier, and diff check. Its two
pnpm-shim attempts failed only because the isolated review environment could
not fetch signed registry metadata; direct repository binaries passed.

The ninth remediation red run passed 185 of 195 focused tests and reproduced
all ten representative fail-open forms, including both Cookie header variants
and a commented RFC identity. The scanner now:

- removes bounded parenthesized, bracketed, and slash qualifiers before
  classifying a secret-like field while retaining the original value and exact
  redaction checks;
- routes JSON scalar and embedded prose Cookie fields through the same
  authentication-cookie classifier used by plain, list, and table headers;
- decodes bounded JSON string literals before identity classification and
  recognizes quoted or commented local parts without changing the explicit
  public/reserved identity allowlist; and
- normalizes HTML numeric/named entities, percent encoding, and Markdown
  escaping for the identity separator after a self-review reproduced those
  equivalent representations.

Explicit negative controls retain redacted qualified secrets, redacted or
non-authentication JSON cookies, encoded public/reserved identities,
version-at-commit source refs, and the canonical source-reference schema regex.
Focused, compatibility, and full serial suites now pass 206, 347, and 1,577
tests respectively. The full suite completed across 104 files in 145.40 seconds.
All eight canonical artifacts pass independently, and the packet remains 14,398
bytes with SHA-256
`7e1501caa7db4f38957788b97c4685602ebd7b3f54e38429ab840f9905b3be58`.

Positive leak fixtures cover passwords, password hashes and plaintext variants,
raw/compact/postfixed access and refresh tokens, standalone provider tokens,
authentication cookies across plain, Markdown, JSON, and embedded header
representations, key/secret hashes and material, token signatures and bearer
fields, wrapped and unwrapped keys, encrypted item bodies, identity payloads,
provider payloads, profiles, secret-like schema fields, Authorization
credentials across headers and CGI variables, qualified/bracket-wrapped and
Markdown-formatted assignments, JWTs, EncString types 0-7, private-key blocks,
and literal, Unicode, quoted, commented, JSON-escaped, HTML-encoded,
percent-encoded, or Markdown-escaped personal identities. Approved digests,
versions, counts, enums, source refs, repository paths, limitation text, exact
non-secret count summaries, exact redactions, non-authentication cookies,
malformed EncString shapes, verification markers, package scripts, and public
or reserved example identities remain accepted.

## Current Verification

| Gate                        | Readback                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Focused generator/scanner   | 206/206 passed                                                                           |
| Compatibility impact        | 347/347 across 5 files passed                                                            |
| Full suite                  | 1,577/1,577 across 104 files passed serially in 145.40 seconds                           |
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
