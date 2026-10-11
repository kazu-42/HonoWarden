# Integration verification checkpoint

Updated: 2026-09-22. Status: local integration verified; release blocked.

The final acceptance section below supersedes historical in-progress and STOP
checkpoints. Release/Worker execution is not authorized by local test success.

The user's subsequent "どんどん進めて" authorizes the requested bounded
HON-210 repair and verification. External mutation prohibitions remain intact.
Repair plan: reproduce same-timestamp sequential/concurrent registration on
real local D1; gate insertion on the immediately preceding consume UPDATE in
the same batch (existing repository `changes() = 1` pattern); verify atomic
rollback on insert failure; independent re-review; unchanged-source final gates.

## Source identity

- Base and freshly fetched origin/main: `2846198beb18c085771b6d91a6a7ed28ac51d27e`.
- Original four-candidate commit: `9e89c2ab94b61c6d28ed824e19db6edaebaad6c3`.
- Landed equivalent: `744097a4f3e31b7511f17e50d6b83356ac63fdd9`.
- The original and landed commit have identical tree
  `7116d9137c1ae708a21665ddfa7f3eea91720a18`.
- Follow-up changes remain uncommitted in this worktree. No commit, push, PR,
  deployment, Cloudflare API operation, or secret operation was performed.

## Verified bounded changes

- Explicit environment: eight existing fixture failures reproduced after
  missing/empty runtime environment became invalid. Updated local fixtures
  supply `development`; production/staging metadata failures remain 503.
- Focused provenance, app, hosted-tenancy, audit, and token tests:
  7 files / 367 tests passed. Typecheck passed at that checkpoint.
- Metadata freshness: 12 tests failed before implementation and passed after.
  Exact cadence/stale boundaries, invalid/future timestamps, and invalid
  policy values are covered with explicit observation times.
- Release gate: two tests reproduced stale metadata being accepted; the
  current-tree check now blocks while sealed alpha archive checks still pass.
- Combined matrix/freshness/release tests: 3 files / 40 tests passed.
- Release/provenance documentation checks: 2 files / 43 tests passed before
  the subsequent historical staging and operator documentation edits.
- Typecheck and lint passed before the subsequent documentation/fixture edits.

These are checkpoint results, not final verification of all current bytes.
The full-suite diagnostic run began before the latest documentation changes.
It must not be used as a final unchanged-tree result.

Additional diagnostic observations on 2026-09-22:

- Latest typecheck, lint, brand scan, and `git diff --check` passed.
- Route replay, HON-223 date reconciliation, and tag-preflight focused tests
  passed in the 4-file rerun. Its only failure exposed the approval packet
  discarding nonzero preflight JSON and therefore losing commit identity.
  The approval packet now consumes non-strict JSON and still requires explicit
  ready statuses. Its three tests passed after this correction.
- The full diagnostic suite in session `55895` finished with exit 1 and
  21 failures. It ran across edits and is not final unchanged-tree evidence.

- Subsequent runbook/release/WebAuthn focused tests: 3 files / 58 tests passed.
- Full-suite diagnostics found omitted environment values in WebAuthn and
  route-replay fixtures; both fixtures now supply explicit development.
- Current-state date assertions were reconciled to 2026-09-22.
- Freshness STOP propagates through release approval, status, publication,
  completion, evidence-bundle, and ops-readiness packets. Their consumers need
  semantic reconciliation: future publication must remain blocked, while
  historical published-release verification must use the sealed archive
  appropriately. Do not merely change every expected success to failure.
- Tag preflight and approval expectations now assert the stale-current gate
  failure while retaining their other positive evidence assertions; rerun is
  pending.
- Full formatting found one WebAuthn fixture formatting issue, now formatted;
  final format verification remains pending.

## Completion checklist and remaining release restriction

- [x] Confirm latest origin/main and identical original/landed candidate trees.
- [x] Preserve all four candidates and later main work without duplicate application.
- [x] Resolve follow-up findings, including the user-approved HON-210 repair.
- [x] Verify explicit environment fixtures, matrix completeness/freshness,
      isolated fresh-current success, and corrupted historical archive rejection.
- [x] Review expanded documentation coverage and preserve historical records.
- [x] Pass final focused, full, compatibility, typecheck, lint, format, and brand checks.
- [x] Obtain independent final code review and resolve blocking findings.
- [x] Preserve original HON-184 history and update current acceptance/evidence.
- [x] Verify release STOP without bypass or remote/secret operations.

Release restriction (not concealed by local integration acceptance): the real
current client matrix remains stale. A future release requires official-source
metadata refresh and fresh exact-version evidence. Merely changing checkedAt,
promoting fixture-only clients, deploying, publishing, or enabling writers is
outside this completed local integration task.

All Send routes and tracked writer activation remain outside this task.

## Release packet reconciliation and review packet

- The 7-file release packet diagnostic completed with 28 passing and 5 failing
  tests. Stale metadata correctly withheld draft publication approval and
  commands; the remaining expectations now assert that fail-closed behavior.
- A subsequent 3-file run had 18 passing and 1 failing test, isolating loss of
  commit identity in the evidence bundle: strict child exits discarded JSON.
  The bundle now reads non-strict child reports and independently requires
  ready statuses; source alignment remains a separate required check.
- Independent review packet: read-only review of the entire uncommitted diff,
  emphasizing current versus historical release gates, freshness validation,
  environment failure modes, token STOP, and any weakened test coverage.
  Reviewer may inspect code and run isolated checks, but must not edit files,
  commit, push, create PRs, deploy, or access Cloudflare/secrets. Return concrete
  findings with file/line evidence and the exact reviewed diff identity.
- Main agent owns static/compat/full verification and documentation coverage;
  review findings must be reconciled before claiming completion.

## 2026-09-22 later checkpoint

- Release packet reconciliation: 8 files / 36 tests passed (session `22578`).
  Current draft publication remains blocked; published historical verification
  still succeeds with valid archive/tag/release evidence.
- Typecheck, lint, and full formatting passed before the later scanner and
  matrix-structure changes. Compatibility checkpoint: 8 files / 969 tests passed
  (session `88500`). These are not final unchanged-tree acceptance.
- Independent reviewer requested changes: a fresh matrix with empty, missing,
  duplicate, or unknown client surfaces could pass the release inspector.
  Four regression cases reproduced the defect. The inspector now requires
  each of the five client surfaces exactly once; the actual sealed alpha
  shape remains accepted. Combined matrix/freshness/release/runbook rerun:
  4 files / 84 tests passed (session `80078`).
- Documentation scan now recursively checks README and all docs Markdown,
  including new documents, and rejects unclassified writer recipes. Red run
  found eight historical command lines outside the former fixed list. Exact
  historical records remain preserved; Cloudflare-resource and website
  evidence now explicitly deny current execution authority. The website's
  old rollback instruction is now a historical proposed recovery only.
- Initial independent review was REQUEST_CHANGES, source-script diff SHA-256
  `763203bfbc1291fd376b2fe49e7a69762d24664196bf2b1431101516ec8ac539`.
  Bounded re-review confirmed the structural fix and found no remaining
  production/runtime blocking finding at source diff SHA-256
  `daddd31a58f5455aa286672a2780da42dde498a33a0c1647bef7efaa9db1bfa3`.
  Additional recommended regressions: a legitimately fresh complete matrix
  reopens current acceptance, while corrupt archived bytes still block
  historical verification. Do not alter shared archive bytes for testing.
- No final full-suite rerun has started since the mixed-tree diagnostic.
- The re-review found a scanner false negative for a historical dry-run and
  secret mutation recipe on the same logical line. A regression reproduced
  it; allowed dry-run spans are now removed before scanning remaining text.
  Latest runbook/matrix/release focused run: 3 files / 72 tests passed, and
  scanner formatting passed (session `66159`).
- Typecheck, lint, and brand scan passed again after the matrix structure fix
  and before the final scanner-only adjustment (session `49670`).
- Strict release gate at `2026-09-22T04:41:31Z` exited 1: 11 pass / 1 block.
  Exact STOP: `current_client_matrix` metadata is stale, checked at
  `2026-08-16T03:35:28Z`, stale since `2026-09-06T03:35:28Z`.
  Historical evidence and the sealed alpha archive remain consistent;
  execution is `not_admitted`. No deployment or later execution gate was run.

## Final verification attempt and new integration blocker

- Fresh `origin/main` readback remains
  `2846198beb18c085771b6d91a6a7ed28ac51d27e`. Both candidate commits still have
  tree `7116d9137c1ae708a21665ddfa7f3eea91720a18`, and landed `744097a4...` is
  an ancestor of main. No duplicate candidate application is needed.
- Independent final code review: APPROVE within reviewed code/document scope,
  with no remaining blocking finding in the reviewed diff. Reviewed tracked
  diff SHA-256: `bbeb69cae12279d4eef8d0bbaa71e3f0dbf0aeb340111a88fd4cb936b19cf493`.
  Runtime/script diff SHA-256:
  `daddd31a58f5455aa286672a2780da42dde498a33a0c1647bef7efaa9db1bfa3`.
  Review does not certify the later full-suite result.
- Added isolated release fixture tests: current freshness strict success,
  corrupted archive rejection by the gate, published packet, and completion
  audit. Five published-packet tests passed. Only copied fixture metadata was
  refreshed; the real matrix and shared archive were not modified.
  Fixture copies are retained for diagnosis; no cleanup of protected evidence
  or sibling worktrees was performed. The document scanner is a defined-pattern
  regression guard, not a general shell parser or security sandbox.
- Final-attempt static checks: typecheck, lint, format, brand scan, and
  `git diff --check` passed. Focused four-candidate tests: 15 files / 233 passed.
  Compatibility: 8 files / 973 passed.
- Unchanged tracked/test-source full run: session `79892`, terminal exit 1,
  147 files: 146 passed / 1 failed; 2,629 tests: 2,628 passed / 1 failed;
  duration 190.24 seconds. JSON report:
  `/tmp/honowarden-final-verification.ePrql3/full-results.json`.
  The only failure is the HON-210 enrollment replay no-partial-write assertion
  at `test/app-webauthn-enrollment.test.ts:254` (two credentials instead of one).
- Deterministic diagnosis, without changing production or ordinary test bytes:
  the ignored `test/.tmp/webauthn-replay-repro.config.ts` freezes Date only;
  running the existing replay test reproduces the same failure. Separately,
  `test/.tmp/webauthn-replay-d1.config.ts` runs a minimal real local D1 database
  with the actual `0015` WebAuthn schema and `completeWebAuthnRegistration`.
  First registration succeeds; same-millisecond replay returns `not_consumed`
  but inserts a second distinct credential. Both red diagnostics are retained.
- Root cause observed in `src/repositories/webauthn-repository.ts`: the insert
  checks a persisted `consumed_at` timestamp rather than proof that this batch
  consumed the challenge. An earlier successful batch with the same timestamp
  satisfies that predicate even when the current UPDATE changes zero rows.
  The production repository file is unchanged from origin/main.
- STOP: full integration acceptance is not proven. The user was asked whether
  to include the additional HON-210 authentication fix in this four-candidate
  integration task. No implementation of that out-of-candidate fix has begun.
  No deploy/execution step followed the failed full gate. Client-metadata stale
  STOP remains an independent release blocker.

## Authorized HON-210 repair

- The user authorized proceeding after the explicit scope question. No
  deployment, schema change, or runtime enablement was authorized or performed.
- Promoted deterministic replay reproduction into the ordinary route test
  (Date only frozen) and actual full-migration local D1 tests. Red: route replay,
  sequential D1 replay, and concurrent D1 attempts all inserted extra rows.
- The credential INSERT now requires `changes() = 1` from the immediately
  preceding challenge UPDATE in the same atomic D1 batch. Existing owner,
  purpose, RP, origin-policy, expiry, duplicate, and count predicates remain.
  Fake-D1 follows that statement-result dependency only in its WebAuthn branch.
- Three files / 31 tests pass, including 10 added real D1 cases: same-time
  sequential replay, four-way concurrency, insertion failure rollback and
  retry, six failed-consume conditions, and duplicate/count-limit preservation.
  Typecheck passed. The ordinary tests supersede the retained ignored repros.
- Independent review approved the bounded implementation. Final re-review
  includes the subsequently added failure matrix and type-safety adjustments.
- Final verification will keep source/test bytes fixed; only verification
  results and status documentation may be appended after results are known.

## Final local acceptance — 2026-09-22

Identity and independence:

- Base HEAD and freshly fetched origin/main:
  `2846198beb18c085771b6d91a6a7ed28ac51d27e`.
- Full run before/after tracked patch SHA-256:
  `971535d35bb35f680cc62423ecdfc2bff12568f99e348bcf215c963bf382898c`.
- Tracked source/script/test patch SHA-256 (unchanged through verification):
  `56e2dbb826e8251814a335715220ca60cec859649a917845fa28e594956ff78e`.
- Untracked freshness test SHA-256:
  `336e66888f0f904db005afc17a37a3ace37fc4dfa242c7e752d6f94d12445009`.
- Untracked isolated release fixture helper SHA-256:
  `e1b71cccb55f1fec57de8cac911fa021f79220a0b3d0bac881690ed11dcb6f47`.
- Independent final review: APPROVE, no unresolved blocking findings;
  reviewed tracked patch `971535d3...`, production patch
  `9cc043ab8b2f7ba153a868ff52f0ce025d53a25bf7edf9940c9110be5350e4d4`.
  Review did not substitute for test execution and claims no hosted D1/client run.

Verification:

| Requirement                                             | Final evidence                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Harness, Text Send, provenance, matrix, HON-210 focused | 18 files / 264 passed, session `65838`                                                              |
| Compatibility                                           | 8 files / 973 passed, session `8991`                                                                |
| Full suite                                              | 147 files / 2,639 passed, zero failed or skipped, session `12348`                                   |
| Typecheck                                               | `pnpm check`, exit 0, session `83655`                                                               |
| Lint                                                    | `pnpm lint`, exit 0, session `20169`                                                                |
| Format                                                  | `pnpm format`, exit 0, session `22485`                                                              |
| Brand                                                   | `pnpm brand:scan`, exit 0, session `58842`                                                          |
| Whitespace                                              | `git diff --check`, clean                                                                           |
| Release                                                 | Expected strict STOP: stale current metadata; historical archive consistent; execution not admitted |

The full command was `pnpm exec vitest run --reporter=default --reporter=json
--outputFile.json=/tmp/honowarden-final-verification.z0qhtq/full-results.json`.
It completed with exit 0 in 257.82 seconds. The previous failing report remains
at `/tmp/honowarden-final-verification.ePrql3/full-results.json` for diagnosis.
Final status/evidence documentation is updated only after these results;
source/script/test bytes are unchanged and their digests are rechecked.

Safety and scope audit:

- Four-candidate source tree equality and landed ancestry establish containment;
  no cherry-pick replay or conflict resolution that would overwrite later main
  additions was necessary.
- Text Send remains source-only; public Send routes/grant stay unsupported and
  config stays disabled. WebAuthn stays default-off in all tracked scopes.
- No package/lockfile, migration, Wrangler configuration, client snapshot, or
  sealed archive bytes changed in this follow-up.
- Root checkout's three intentional tracked changes and untracked artifacts
  remain untouched; the integration worktree contains the uncommitted deliverable.
- No commit, push, PR, live client invocation, deployment, Cloudflare resource
  change, credential/secret operation, or historical evidence cleanup occurred.
- Reverting only this follow-up's uncommitted changes would restore main, but
  would also restore the diagnosed HON-210 defect; no automatic rollback or
  revert was performed. Do not reset or remove the worktree containing the work.

Final closeout readbacks:

- Status-document updates passed 4 files / 587 tests (session `93980`), followed
  by full formatting and brand checks. Source/script/test patch SHA-256 remains
  `56e2dbb826e8251814a335715220ca60cec859649a917845fa28e594956ff78e`.
- Standalone `node scripts/honowarden-release-gate.mjs --strict` at
  `2026-09-22T05:16:38.890Z`: exit 1, 11 pass / 1 block; only
  `current_client_matrix` is blocked (stale). Historical evidence and the
  sealed archive are consistent; execution is `not_admitted`.
- Independent evidence review directly inspected the full JSON report and
  current code/test hashes and approved the status/evidence distinctions.
  Its two remaining readback conditions (post-document tests and standalone
  release result) are both satisfied as recorded above.
- Local integration requirements are complete. Stale metadata and any future
  release, live-client verification, publication, or deployment remain separate
  work and are not silently represented as passing or authorized.

## 2026-09-22 Metadata-refresh follow-up

The user subsequently requested the remaining metadata work. This section
supersedes the stale-metadata block above, not its historical observations or
the exact-version client evidence boundary. No production code changed in this
follow-up; the runtime remains API-only and pre-alpha.

### Official source readback

Observation time: `2026-09-22T05:32:22Z`. Read-only official GitHub release
listing calls used the repository aliases and stable-release selectors defined
in `compat/client-matrix.json`. The client-apps listing was paginated; the mobile
listings included the latest 30 releases. Drafts, prereleases, web releases, and
mobile Authenticator releases were excluded by the existing selectors. Each
selected tag was then individually re-read via the release-by-tag API. No
mutation, authentication bypass, or installation was involved.

| Surface           | Repository ref      | Release ID | Release tag       | Build | Published at         |
| ----------------- | ------------------- | ---------- | ----------------- | ----- | -------------------- |
| browser_extension | client-apps         | 393320532  | browser-v2026.9.1 | —     | 2026-09-21T21:57:20Z |
| desktop           | client-apps         | 390758630  | desktop-v2026.9.0 | —     | 2026-09-17T13:52:45Z |
| cli               | client-apps         | 390741665  | cli-v2026.9.0     | —     | 2026-09-17T13:28:40Z |
| mobile_android    | android-mobile-apps | 390158551  | v2026.9.0-bwpm    | 21909 | 2026-09-18T14:05:00Z |
| mobile_ios        | ios-mobile-apps     | 390158127  | v2026.9.0-bwpm    | 3521  | 2026-09-18T13:26:07Z |

Every selected release returned `draft: false` and `prerelease: false`.
Build numbers came from the official Password Manager release titles. All five
rows remain `fixture_only`, with no `liveEvidence` field. Covered flows and
historical limitations are unchanged. The sealed alpha matrix and evidence
bytes were not edited. The next required refresh is due on
`2026-10-06T05:32:22Z`; the stale boundary is `2026-10-13T05:32:22Z`.

### Verification and invariants

- RED: updating the exact-release test pins first produced two expected
  failures against the old matrix (session `93261`).
- GREEN: current matrix, freshness policy, and release-packet tests passed
  11 files / 85 tests (session `39199`). The new test-only child-process clock
  passed both fresh/stale inheritance tests (session `58710`).
- Packet rejection tests now observe `checkedAt + staleAfterDays + 1 day` in
  their child processes, including nested CLIs. The real production clock and
  checked-in metadata are not overridden. The isolated fresh-matrix positive
  and corrupted-archive negative tests remain. This preserves fail-closed
  coverage across future metadata refreshes without adding a production bypass.
- An initial typecheck exposed the Workers-global versus Node URL type mismatch
  in the new test helper; explicit `node:url` imports fixed it. Typecheck then
  passed (session `93203`); lint and brand scan passed (`95610`, `9247`).
- Standalone strict release evidence at `2026-09-22T05:33:55.466Z` returned
  exit 0, 12 pass / 0 block, current and historical evidence `consistent`, and
  `executionStatus: not_admitted`. This is evidence readiness, not permission
  to publish, deploy, or enable runtime writers.
- The live-regression packet normal-path test still used a July timestamp and
  CLI 2026.7.0. A focused run correctly rejected it as pre-release evidence
  (session `70161`). The normal-path fixture now derives version and run time
  from the current matrix; pre-release and identity mismatch rejection cases
  remain. All 9 packet tests passed after correction (session `65042`).
- Full follow-up: **148 files / 2,641 tests passed**, zero failures or pending
  tests, exit 0 in 216.99 seconds (session `76552`). Report:
  `/tmp/honowarden-metadata-refresh.oQD8Ve/full-results.json`. The corrected
  live-regression packet tests also passed within this full run. Final
  typecheck and lint passed (`57227`, `41146`); formatting, brand scan, and
  `git diff --check` passed. Alpha snapshot, sealed archive, migration,
  package/lockfile, and Wrangler configuration diffs are empty.
- Production source/script patch SHA-256 remains unchanged from the preceding
  verified integration:
  `9cc043ab8b2f7ba153a868ff52f0ce025d53a25bf7edf9940c9110be5350e4d4`.
  Current matrix SHA-256:
  `42e0617f501ee899e8d5733db95c59a6f7e4330a0e3f6a31df889331ca3afcce`.
  No commit, push, PR, or external state change was performed. Previous
  integration work and the root checkout's intentional dirty files remain.
- Final post-document focused verification passed 13 files / 96 tests
  (session `79913`); full formatting and brand checks passed (`47136`, `93873`).
  A final standalone strict gate at `2026-09-22T05:39:05.419Z` again passed
  12 checks / zero blocks, with fresh current metadata, consistent historical
  evidence, no promoted rows, and execution still `not_admitted`.

### Remaining exact-version live work

The existing official-client harness pins CLI 2026.6.0 assets and their hashes.
It cannot establish current CLI 2026.9.0 compatibility. Before promoting any
row, verify current official assets and hashes, prepare an isolated synthetic
loopback-only profile, execute the exact version/build, and capture redacted
request/response evidence for each claimed flow. Browser/Desktop and mobile
rows likewise require their own exact-version binary/device runs. No historical
evidence or metadata timestamp may substitute for those runs. No application
install, live-client invocation, publication, deployment, Cloudflare resource
mutation, or secret operation was performed in this follow-up.

## 2026-09-22 Current-client execution follow-up

After the user requested continued closeout, the actual official CLI 2026.9.0
macOS arm64 binary was downloaded with its official asset ID/size/SHA-256
verified, and executed against a fresh synthetic account on isolated local
Wrangler/D1. It failed login at the missing user-key-ID backfill endpoint
after HTTP 200 authentication and initial sync. This is a new functional
compatibility blocker, not a metadata failure or passing smoke result.

Authoritative redacted evidence and exact public-source observations are in
`docs/release/current-cli-2026-9-smoke.md`. The current CLI matrix known issue
now records the observed 404. All five current rows remain `fixture_only`.
No new API, migration, or runtime-writer activation was performed. The source
fix requires accepting the new user-key-ID storage/backfill/rotation scope;
the user was asked for direction. Exact official iOS execution separately
requires an available authorized test device; the registered device was
unavailable and the published asset is device-only.

Run-owned Worker and TLS proxy resources were stopped. Ignored diagnostics and
earlier setup attempts are preserved. No normal client profile, existing AVD,
real account, remote runtime, deployment, publication, or secret was modified.

The evidence/matrix/documentation follow-up passed 4 files / 581 tests
(session `70443`), brand scan (`11037`), and `git diff --check`. These checks
validate repository evidence consistency, not the failed native client flow.

## 2026-09-22 Approved User-Key ID Implementation And CLI Repair

The user explicitly approved new API/storage/rotation implementation and
current CLI revalidation, limited to local synthetic work. The user also
connected and authorized the physical test iPhone. No staging/production
mutation, publication, push, or deployment was authorized or performed.

Implemented:

- authenticated default-off user-key ID registration with bounded canonical
  input, owner/generation CAS, monotonic revision, and mandatory atomic audit;
- forward-only migration 0022, nullable ID storage, CHECK validation, and
  stale-ID invalidation for old wrapped-key writers;
- current sync `userDecryption.userKeyId` and contained-key metadata projection;
- optional rotation ID, rejection of current-ID reuse, and atomic replace/clear;
- all tracked writer flags false, migration hash and route inventories updated;
- operation/rollout/rollback documentation in `docs/operations/user-key-id.md`.

TDD first reproduced missing parser/rotation support. Real local D1 then
covered duplicate/concurrent registration, old generation and owner rejection,
audit rollback, schema constraints, old-writer invalidation, API auth/validation,
sync readback, and rotation replace/clear/reuse rejection. Focused verification
passed 5 files / 82 tests. An intermediate native run exposed missing root
sync ID projection despite successful first login; a failing assertion captured
that difference before the repair.

The exact unmodified official CLI 2026.9.0 finally passed at
`2026-09-22T09:56:02.367Z`: initial login/backfill, populated sync, five decrypted
fields, lock/unlock/sync/decryption, logout, and a second login/decryption
without another backfill. Final run root:
`test/.tmp/current-cli-20260922-wwV0oV/`. The 20 redacted requests all returned
200 and the registration request occurred once. Run-owned Worker/TLS proxy
cleanup completed. Only the current CLI matrix row is promoted to `live_smoke`;
no broader regression or other-client claim is inferred.

iOS: wired/paired iPhone 15, OS 26.5, Developer Mode enabled, no pre-existing
target app. Official 2026.9.0 build 3521 asset checksum and code signature
verified, but normal installation failed with `0xe800801f`, Beta profile
entitlement rejection. The user was asked for App Store/authorized TestFlight
installation; no re-signing or protection bypass was attempted. Exact iOS
runtime validation remains blocked by installation, not by absent consent.

The first full test pass attempt was not accepted: 150 files, 2,641 passed /
26 failed. Failures exposed test schema/inventory/release metadata maintenance
and five slow operational cases hitting existing timeouts. The schema and
evidence expectations were corrected without weakening validation or changing
sealed archives. Follow-up integration tests passed 101/103, with the final two
stale expectation failures subsequently fixed; the affected 4-file rerun passed
63/63. Serial revalidation of the five slow-case files passed 66/66 with
unchanged timeouts (`/tmp/honowarden-key-id-verification.H5qlvy/slow-followup.json`).
Strict repository-evidence readback after maintenance
passed 12 checks, zero blocks, while execution stayed `not_admitted`.

### Final Full-Source Run: Not Clean

`pnpm exec vitest run --maxWorkers=1 --reporter=json` ran all 150 files and
2,667 tests with no skips: 2,663 passed and four failed. Report:
`/tmp/honowarden-key-id-verification.H5qlvy/full-final.json`.

- `credential-closeout.test.ts`: dense benign JSON scanner measured 341.53 ms
  against the existing 250 ms bound.
- `kdf-population-migration.test.ts`: reached the existing 60 s timeout.
- `release-evidence-bundle.test.ts`: two cases reached their existing 20 s
  timeouts.

All new key-ID tests and rotation tests passed in this full run. These four
failures are time-sensitive, but the full run is **not** relabeled as passed.
No test is excluded and no timeout/performance bound is relaxed. Exact-file
recheck results are recorded separately below; full-suite one-shot acceptance
remains a distinct gate from the passed native CLI smoke.

The runtime/source fingerprint was unchanged before and after this full run:
150 files under tracked/untracked non-ignored `src`, `migrations`, `scripts`,
plus `wrangler.jsonc`, `package.json`, and `pnpm-lock.yaml`. Sorted path and
SHA-256 content digest pairs, separated by NUL/newline, hash to
`e9f4f22f2a837a7228e44a9e1adcd318a12d8e3e87b1223eae3d8aee3980cf86`.
Typecheck, lint, formatting, brand scan, route inventory, and diff whitespace
checks passed. The sealed published-alpha matrix and evidence hashes are
unchanged. No commit, push, remote migration, or deployment was performed.

The unchanged-condition recheck of all three affected files passed 257/257:
`/tmp/honowarden-key-id-verification.H5qlvy/timing-recheck.json` (107.48 s).
This includes all four failed cases. The KDF case completed in 51.01 s and
both previously timed-out bundle cases completed within their original 20 s
bounds. No source correction, timeout extension, benchmark relaxation, retry
wrapper, or test exclusion was used for this recheck. The successful recheck
supports time-dependent behavior; it does not retroactively make the preceding
full-suite run green. Local API/native CLI work is verified within its stated
scope; one-shot full-suite acceptance and exact iOS execution remain separate
unmet gates.

## 2026-09-22 iOS Installation And Pre-Login Readback

The user installed the official iOS client after the direct-IPA rejection. Scoped
device inspection confirmed its official bundle, version 2026.9.0, build 3521,
including a fresh readback at 2026-09-22T10:57Z. Normal `devicectl` launch
succeeded. After user-completed iPhone Mirroring setup, a window-only screenshot
at 10:55Z showed the pre-login onboarding screen with account creation and
login buttons. Installation is no longer a blocker. These observations are
not login, sync, or decryption evidence; the iOS matrix row remains
`fixture_only`.

The prior CLI harness was reviewed: its HTTPS listener and certificate are
loopback-only, so that configuration cannot serve the physical iPhone as-is.
The proposed replacement is an isolated local-LAN HTTPS lane with a short-lived
test CA, synthetic data only, and cleanup after testing. Device trust changes
require explicit approval before execution. No CA/profile was installed, no
trust/DNS setting changed, no public tunnel opened, and no Worker/proxy started
in this follow-up. Existing private diagnostics and dirty worktree changes
were preserved.
