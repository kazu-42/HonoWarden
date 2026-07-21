# CLIENT-2: Single-Account Credential Lifecycle

Status: integrated lifecycle, clean-profile browser verification, and local
gates passed; corrected exact-head review reruns remain pending

Linear issue: HON-220

## Start Readback

- base: `1b7258da9a995648354cf2ca453210026ceada98`
- predecessor HON-219: Done and archived
- HON-220: In Progress and non-archived
- parent HON-207: In Progress
- successor HON-221: Todo
- production mutation, remote D1/R2 writes, real credentials, normal browser
  profiles, paid actions, and compatibility promotion remain excluded;
  production and staging received only a read-only `0016` migration query

## Delivered

- Added `pnpm account:credential-lifecycle` with plan-only defaults and explicit
  `run --execute --confirm credential-lifecycle` mutation gates.
- Created one synthetic local account and advanced it through account-key
  initialization, password change, PBKDF2 to Argon2id, Argon2id back to PBKDF2,
  complete user-key rotation, and Worker restart.
- Verified every committed generation with the pinned unmodified official CLI:
  login, lock, unlock, sync, and decrypted item read.
- Namespaced ten one-use official CLI profiles with a random validated run ID.
  Baseline, immediate account-key readback, every transition, every
  post-transition restart check, and final restart readback use separate
  profiles. A prior run can remain logged in without making a later run fail
  or requiring destructive shared-profile cleanup.
- Rejected the preceding password, access token, refresh token, and official
  CLI profile at every owning credential transition.
- Injected a required-audit failure and proved HTTP 503 plus exact D1 rollback
  and unchanged R2 bytes.
- Submitted two concurrent complete rotations and proved exactly one generation
  committed.
- Replayed a pre-rotation wrapped generation with a newly issued current token
  and current generation proof, then proved the route rejected the stale
  generation with the exact HTTP 400 invalid-request contract before and after
  Worker restart. D1 and R2 remained byte-for-byte unchanged.
- Added forward-only migration
  `0016_user_key_rotation_wrapper_history.sql`. It stores only per-user SHA-256
  fingerprints over the encryption type and length-framed decoded EncString
  parts in one cross-role digest namespace. Equivalent padding and ignored
  trailing-bit encodings share one fingerprint. Account-key initialization,
  password, KDF, and complete user-key mutations atomically record current and
  next wrappers, preventing recorded historical or mixed-wrapper replay without
  retaining ciphertext. The boundary is forward-looking; pre-`0016` superseded
  wrappers are not reconstructable, so rollout drains credential mutations
  across activation.
- Restarted the Worker and TLS proxy, then proved the final generation remained
  decryptable while the preceding access token remained rejected.
- Re-read D1 after the browser run and required zero foreign-key violations.
  The audit scanner checks every issued access and refresh token shape rather
  than only the initial synthetic material.
- Added clean-profile Chrome for Testing readback using the pinned official
  browser extension. It configures only the local synthetic origin, logs in,
  observes all required API routes, opens the expected item, and verifies six
  decrypted fields.
- Browser bootstrap runs behind a dead loopback proxy and fail-closed host
  resolver. Default upstream requests must be blocked with no response before
  a fresh credential popup is observed; the credential evidence phase itself
  permits no external request or response.
- Browser diagnostics are fail-closed. Only exact known local limitations are
  classified as non-blocking and each network-related diagnostic must correlate
  with its exact blocked request/loading failure. CDP Runtime/Log replay events
  are separated by an evidence epoch. Unknown console, loading, response, or
  runtime diagnostics fail the run. Stored diagnostic evidence contains
  categories and digests rather than raw messages.
- Browser CDP close and error events now latch a terminal health error unless
  the client itself initiated the close while the socket was still open. An
  already-closing remote socket cannot be relabeled as an explicit cleanup.
- Browser, profile, clipboard, TLS proxy, Wrangler, workerd, and temporary
  managed state cleanup are idempotent and bounded.

No remote Cloudflare resource, real account, normal Brave/Chrome profile,
compatibility row, routing, or deployment changed. Read-only production and
staging D1 queries confirmed that migration `0016` is not applied in either
environment; both returned zero rows and wrote zero rows.

## Integrated Readback

The latest aggregate run began at `2026-07-21T01:24:33.693Z` and returned
`status: passed`.

| Evidence                    | Readback                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Mode                        | local Wrangler + D1/R2 + official CLI + official browser extension                                    |
| Generation manifest SHA-256 | `a894eb81bf721f57ce8f925fc024bc6024ee83a67ef24da566642ccf9ab7eab2`                                    |
| Same-account generations    | 7/7                                                                                                   |
| Official CLI item reads     | 7/7                                                                                                   |
| Successful CLI stderr       | 0 bytes, including config read/write                                                                  |
| Old passwords rejected      | 4/4                                                                                                   |
| Old access tokens rejected  | 4/4                                                                                                   |
| Old refresh tokens rejected | 4/4                                                                                                   |
| Stale CLI profiles rejected | 4/4                                                                                                   |
| Required-audit rollback     | HTTP 503; D1 unchanged; R2 unchanged                                                                  |
| Concurrent rotations        | HTTP 200 and 401; exactly one generation committed                                                    |
| Stale wrapped generation    | HTTP 400 before/after restart; D1/R2 unchanged                                                        |
| Audit secret scan           | passed for every issued token and token shape                                                         |
| Final wrapper history       | 7 unique fingerprints; set SHA-256 `6dc6908dc86be230c8bffd08cf1373f6676c3ea294d9874e76851e3de22d701b` |
| Final foreign-key errors    | 0                                                                                                     |
| Final restart readback      | passed                                                                                                |

The seven generation checkpoints were `baseline`, `account_keys`,
`password_change`, `argon2id`, `pbkdf2_return`, `user_key_rotation`, and
`restart_readback`. The first five retained user-key generation 1. Complete
rotation advanced to generation 2, changed the encrypted vault digest, and
preserved the public key required by the official-client fixture contract.
The baseline storage checkpoint is captured before account-key initialization.
The pinned CLI cannot decrypt this fixture until account keys exist, so its
baseline item read occurs immediately after initialization and is explicitly
tagged `accountKeysInitializedAtRead: true`; the separate `account_keys`
checkpoint records the corresponding D1 mutation.
That checkpoint now also requires exactly two cross-role history fingerprints:
the unchanged wrapped user key and the newly initialized wrapped private key.

## Official Client Provenance

| Item              | Readback                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Server source     | `v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0`                                     |
| CLI source        | `cli-v2026.6.0@e6293ff2bc85123e9baaa998cf1543030ec5d9f0`                                 |
| Browser source    | `browser-v2026.6.1@723c075bf8b9f45c901e56195be8e94e43ed75a2`                             |
| CLI source asset  | SHA-256 `31765936eef9beca89298ffb554a658138932d505deebc6b65e02baa065c0660`               |
| Lifecycle bridge  | SHA-256 `1a38398906d268c61ad40b79310d4810125f25d056052404fb0b8dfc23cd6601`               |
| Fixture response  | 24,397 bytes; SHA-256 `69df0949e5bad7be29598fb4dd9ef9a09ddf022d6a69094fef096d95bdb0c233` |
| CLI stdout/stderr | 0 / 0 bytes                                                                              |

All ten CLI profiles were isolated under the ignored harness root. No ambient
`BW_PASSWORD` or `BW_SESSION`, normal browser profile, remote origin, or real
credential entered the run. The wrapper initializes each fresh profile with a
mode-0600 empty JSON document before the pinned CLI reads or writes its server
configuration. Existing profile data is never overwritten.

## Browser Readback

The pinned extension ran in Chrome for Testing `149.0.7827.55` with a new
temporary profile and loopback-only remote debugging.

| Browser evidence           | Readback                                                           |
| -------------------------- | ------------------------------------------------------------------ |
| Extension asset SHA-256    | `fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e` |
| Extension manifest         | `2026.6.1`, Manifest V3                                            |
| Bootstrap external network | 2 requests blocked; 0 responses                                    |
| Evidence external network  | 0 requests; 0 responses                                            |
| Required successful routes | 5/5                                                                |
| Decrypted item fields      | 6/6                                                                |
| Runtime exceptions         | 0                                                                  |
| Unexpected diagnostics     | 0                                                                  |
| Screenshot SHA-256         | `627202ed5c3f186331e4392e7f5857ebd2f2da0c94569000376f033298930e68` |
| Browser/profile/clipboard  | stopped / removed / cleared                                        |
| Residual CDP listener      | none                                                               |

Chromium selected an ephemeral loopback CDP port. The harness read it only
from the private run-owned profile's `DevToolsActivePort`, required
`/json/version` to return the exact recorded browser WebSocket endpoint, and
sent every target/close request through that owned endpoint.

The required HTTP 200 routes were:

- `/identity/accounts/prelogin/password`
- `/identity/connect/token`
- `/api/config`
- `/api/accounts/profile`
- `/api/sync`

The decrypted readback proved the expected item name, username, password,
notes, attachment filename, and cipher route. The screenshot was hashed and
removed rather than retained.

The isolated bootstrap allowed only diagnostics paired with the two requests
proven blocked by the dead proxy and the exact self-signed local configuration
failure. The credential phase classified only exact local host-integration
diagnostics: the notification WebSocket certificate failure and paired SignalR
start failure, cross-origin icon response blocking, and exact messages caused
by the deliberately closed bootstrap tab. Runtime/Log events older than the
phase's wall-clock epoch are ignored only as already-reviewed CDP replay;
events without timestamps remain visible. None of the accepted diagnostics was
an external response or required-route failure. Any unmatched diagnostic
remains fatal, and raw messages are not retained.

## Red/Green Notes

1. The aggregate lifecycle and browser modules began behind failing contract
   tests for stage normalization, complete rotation request shape, official
   CLI stderr rejection, browser route/field requirements, diagnostic
   classification, and cleanup.
2. The first complete non-browser run passed all seven generations, four
   rejection classes, rollback, concurrency, restart, and process cleanup.
3. Browser iteration exposed a cleanup race after `Browser.close`; cleanup now
   waits for child exit before process-group escalation.
4. Browser diagnostics initially risked retaining raw console material.
   Evidence now stores only semantic categories, locations, and SHA-256
   digests, with generic JWT and access-token sanitization on exception paths.
5. The first integrated rerun failed before mutation because fixed profile
   names retained an earlier login. A red test reproduced cross-run overlap.
   Ten run-scoped profiles now make repeated and concurrent evidence runs
   independent.
6. Exact-diff review found missing loopback enforcement, runtime-message
   redaction, symlink persistence rejection, pre-navigation diagnostics,
   post-browser D1 readback, stale-wrapper coverage, full token scanning,
   foreign-key gating, and bounded CDP calls. Each finding received a focused
   regression before the integrated rerun.
7. A stricter successful-command stderr test exposed the official CLI's
   first-read profile initialization notice. The wrapper now creates only a
   private empty profile JSON, leaves existing data untouched, and lets the
   pinned CLI own all server configuration. The real run then passed every
   top-level and nested config stderr gate.
8. Independent review found that the stale-wrapper check reused an old proof
   and therefore exercised password rejection rather than wrapper history. The
   harness now combines current proof/token material with historical wrappers;
   migration 0016 and D1 integration tests make replay rejection durable and
   race-safe.
9. Real-client reruns exposed three additional boundaries: the CLI needs
   account keys before its first item read, logged-in profiles require a stable
   HTTPS origin across restarts, and a failed profile cannot be reused for a
   later rejection proof. Separate checkpoints, stable ports, and ten one-use
   profiles close those gaps.
10. Browser reruns exposed delayed upstream diagnostics and CDP replay.
    Exact request/error correlation, Runtime/Log event epochs, SignalR
    notification pairing, and closed-tab badge classification received focused
    positive and negative tests before the final pass.
11. The final integrated rerun passed with no residual lifecycle, Wrangler,
    workerd, Chrome for Testing, or CDP listener. A post-run scan compared 40
    latest fixture secrets against 1,680 tracked/untracked files and found zero
    matches.
12. Standard review then reproduced four remaining boundaries: password and KDF
    changes rejected valid keyless bootstrap accounts, browser isolation could
    pass without an observed blocked request, concurrent signal cleanup did not
    await the browser's in-flight cleanup, and the documented query budget was
    stale. Five focused failures now lock nullable `IS ?` generation CAS,
    next-wrapper-only initial history, at least one correlated blocked external
    request, shared cleanup completion, and the six-read/eleven-write contract.
    The post-remediation aggregate browser run passed all eleven checks.
13. Native Codex final review was attempted after remediation but stopped at the
    account usage limit before producing a verdict. A tool-free independent
    Claude Opus standard review approved the complete uncommitted diff. Its
    separate five-axis review also approved the candidate while identifying one
    actionable coverage gap: password and KDF replay guards lacked direct real
    D1 tests. Four Miniflare D1 cases now prove cross-role wrapper replay is a
    complete no-op for both mutations and null-safe `IS ?` CAS establishes the
    first wrapped key for both keyless bootstrap paths.
14. A later native Codex review against candidate commit `0ce7867` reproduced a
    secret-retention gap in runtime-exception URLs: descriptions and text used
    the common redactor, but URL paths did not. A focused regression first
    exposed the raw value, then the URL path was routed through the same bounded
    redactor. The corrected tree passed all 1,245 tests and a fresh eleven-check
    aggregate Chrome for Testing lifecycle with complete process/state cleanup.
    The invalid candidate review was stopped rather than treated as approval;
    exact-head reviews must run again after the corrected commit is created.
15. A corrected-head review investigation then exposed an uncovered initializer
    boundary: after a password generation, a historical wrapped user key could
    be submitted as the first wrapped private key because account-key
    initialization neither consulted nor populated the cross-role history. A
    focused real-D1 test reproduced an incorrect `initialized` result. The
    initializer now compares the current/new digests, guards both audit and user
    CAS with history `NOT EXISTS`, and records the current user plus new private
    fingerprints in the same batch. Its history insert is gated by the exact
    committed user/public/private values so a losing same-revision request
    cannot pollute history. A second real-D1 test forces that collision and
    proves one winner, one audit, and only the winner's two fingerprints.
16. Native review of candidate `af6cc2c` reproduced two remaining false-green
    boundaries. Raw wrapper hashing treated padding aliases and ignored Base64
    trailing bits as different history, while an unexpected idle CDP close did
    not reach `assertHealthy()`. Focused unit and real-D1 tests failed first;
    canonical decoded-part fingerprinting and terminal CDP close/error latching
    then made both regressions pass. A remote-close-in-progress test also proves
    cleanup cannot mask the disconnect.
17. Independent preflight review initially raised legacy raw-digest
    compatibility as P1. Full-baseline and live readback proved migration `0016`
    and the fingerprint writer are absent from main, the candidate branch has
    never been pushed, and both production and staging lack schema version
    `0016`. The reviewer withdrew P1 because the canonical writer is the first
    writer for the new empty table. Release-doc and DB-health tests now lock the
    required migration-before-Worker order and rollback boundary.

## Verification So Far

```text
final review regression tests: 78 passed across 4 files
credential impact suite: 467 passed across 10 files
integrated same-account lifecycle: passed
integrated checks: 11 passed
official CLI generation item reads: 7 passed
official CLI isolated profile namespaces: 10
successful official CLI and nested config stderr: 0 bytes
browser required routes: 5 passed
browser decrypted fields: 6 passed
browser bootstrap external requests/responses: 2 blocked / 0
browser evidence external requests/responses: 0 / 0
browser unexpected diagnostics: 0
browser/profile/clipboard cleanup: passed
live residual lifecycle/browser/Worker process readback: none
latest fixture secret scan: 40 values / 1,680 files / 0 matches
real D1 credential-generation suite: 15 tests passed
runtime-exception URL redaction regression: passed
account-key initialization cross-role replay regression: passed
account-key initialization same-revision concurrency: passed
EncString padding and ignored-trailing-bit replay regressions: passed
unexpected CDP close/error and remote-close race regressions: passed
rollout-order docs and wrapper-history DB-health regressions: passed
full serial suite: 99 files, 1,261 tests passed
typecheck / ESLint / Prettier / brand scan: passed
compatibility suite: 105 tests passed
migration/release docs focused suite: passed
release gate: 11 passed, 0 manual, 0 blocked
```

## Remaining Gate

HON-220 remains in progress until corrected exact-head reviews, PR head CI,
merge/main CI, and Linear closeout pass. The native Codex run against candidate
`0ce7867` found a real URL-redaction defect and was stopped after the candidate
became invalid; it is evidence of remediation, not a passing review. The
independent tool-free Opus standard and five-axis reviews must also be rerun
against the corrected publication head. Backup generation binding, restore
equality, disable semantics, and forward recovery remain scoped to HON-221.
