# Final Report: HON-160 Account Credential Mutation

Status: closeout candidate. HON-202 through HON-206 are Done and archived;
HON-207 and HON-223 remain In Progress, and HON-160 remains Todo.

## Outcome

HON-160 was decomposed into six one-PR Linear children with nine exact blocking
relations. HON-202 through HON-206 delivered the credential-generation
foundation, password change, KDF mutation, account-key initialization, and
atomic personal-vault user-key rotation through reviewed merges and archived
Linear closeout. HON-207 owns the remaining official-client, recovery,
publication, and parent-closeout evidence.

The parent remains open because the current HON-223 source candidate still
requires exact-head review and CI, reviewed merge-tree equality, merged-main
CI, and bottom-up Linear closeout. Deployment, production credential mutation,
and runtime activation remain outside this checkpoint.

## Accepted Results

- Pinned official client/server source defined the observable contract and
  separated existing-account mutation from HON-159 initial-password work.
- Current schema, auth, session, audit, and retention boundaries were audited
  before product edits.
- HON-202 through HON-207 were created under HON-160 with exact project, state,
  priority, archive, description, and dependency readback.
- HON-202 implements bounded current-proof parsing, recent-password
  authorization, monotonic generation rotation, owner-wide session revocation,
  outstanding login-with-device authorization invalidation, and a required
  redacted audit row in one guarded D1 batch.
- HON-203 through HON-206 were reviewed, merged through PRs #103 through #106,
  moved to Done, and archived without trashing.
- The archived-inclusive closeout start readback records all six direct
  children by exact ID, rather than treating Linear's one visible unarchived
  child as the complete hierarchy.
- Focused, full, policy, real local D1, and independent-review gates passed.

## Rejected Results

- Password, KDF, account-key, and user-key mutation were not bundled into the
  foundation child.
- No title-only Linear issue was adopted; only canonical marker ownership was
  accepted.
- No real account, credential, private vault data, remote database, production
  resource, or browser/simulator session was used.
- API-only evidence was not promoted to official-client compatibility.

## Historical HON-202 Review And Remediation Record

The following findings and verification counts record the HON-202 publication
sequence as it happened before PR #101 merged. They are retained as historical
security evidence and are not the current HON-160 queue state.

The first independent review found that required credential audit rows were
written even with optional audit emission disabled, while scheduled retention
cleanup was also disabled in that configuration. Scheduled maintenance now
always runs bounded audit-event cleanup, and a regression test plus operations
and security documentation keep the 365-day invariant explicit. A fresh
complete-diff review then reported no actionable findings.

The Codex review of the first published PR head later found a P1 session
resurrection path: an already approved login-with-device request could be
consumed after stamp rotation and mint a session carrying the new stamp. The
same guarded batch now supersedes pending/approved owner requests and clears
their encrypted response keys. Focused HTTP/repository tests and fresh local D1
success, rollback, cross-account, stale-approval, and concurrency evidence pass;
fresh CI and a clean review of the remediated published head remain required.

The next Codex review found two P2 issues. Invalid current-hash proofs exposed an
unthrottled verifier to a stolen recent-password token, and successful rotation
emitted a Worker audit JSON line even when `HONOWARDEN_AUDIT_LOGS=false`.
Security-stamp proof checks now use the existing account/IP failure buckets,
lockout policy, failed-login state, and `Retry-After` response before mutation.
The mandatory D1 audit row remains unconditional while console emission obeys
the operator toggle. Focused app tests and fresh real-D1 lockout, rate-limit,
credential non-mutation, and disabled-console readbacks pass.

The latest exact-head review found one further P2: a durable authenticated
notification WebSocket was checked only at upgrade and survived the D1
generation rotation. The Worker now forwards the authoritative stamp and
monotonic revision to the user-scoped Durable Object, waits for generation
invalidation before returning success, and includes the same generation on
pending auth-request notification delivery. The object rejects delayed older
connections and removes stale registrations before sending metadata. Missing
configuration fails before D1 mutation; a transport failure after commit is an
explicit forward-only partial completion and never restores an old stamp.

The subsequent exact-head review found another P2: ordinary profile updates
advance the account revision without rotating the security stamp, but the first
remediation disconnected a still-authorized socket on either change. The Durable
Object now treats the stamp as the session identity and uses revision only to
order different stamps. Same-stamp profile changes and delayed delivery preserve
the socket without downgrading the active revision.

The next exact-head review found a second P1: refresh rotation revoked the
presented token before inserting its replacement in a later D1 batch. A
concurrent credential rotation could therefore commit between those writes,
after which the late replacement could survive into a future device
reactivation. Password-session creation now requires the exact password hash and
security stamp it authenticated, and refresh rotation inserts the replacement,
revokes the parent, and updates the active device in one generation-guarded D1
batch. A stale generation creates no token and the failure path invalidates the
device session. Unit tests and a fresh real-D1 password, refresh, and sync smoke
cover the corrected writer boundary.

## Historical Child Verification Evidence

- Complete app and notification-hub tests after all remediations: 257 tests
  passed.
- Scheduled retention: 9 tests passed.
- Current full Vitest: 84 files, 958 tests passed.
- TypeScript, ESLint, Prettier, brand policy, and diff checks passed.
- Workflow Node tests: 17 tests passed, including managed Linear checkpoint
  tests.
- Strict release gate: 11 pass, 0 manual, 0 block.
- `results/auth-2a-real-d1-evidence.json` proves fresh migrations, success,
  old-token and stale-auth-request rejection, owner-wide revocation and
  authorization invalidation, response-key clearing, password relogin, atomic
  refresh rotation, refreshed-token sync, audit rollback, cross-account
  isolation, one-winner concurrency, proof lockout and IP rate limiting, and
  disabled console audit emission with mandatory D1 persistence.
- Canonical and independent Linear decomposition readbacks are exact.
- HON-202 source-ready comment independently read back as one exact managed
  comment: 1667 bytes, SHA-256
  `d6e492c056bee7afbaa0accbf12ba98b666887e254254ef4c810cf8cae8380af`.
- Pre-publication independent code review: no actionable findings at that head.
- Focused managed-checkpoint safety and evidence review: no actionable
  findings.
- PRs #101, #103, #104, #105, and #106 subsequently merged; HON-202 through
  HON-206 are Done and archived.
- `results/hon-160-closeout-start-readback.json` records the 2026-07-28 live
  parent, six-child archived-inclusive inventory, team WIP, and HON-164 blocker
  boundary.

## Historical Wave 2 Rebase Verification

- The implementation was fixed in commit `bdfdd5b` before integration and is
  recoverable through `backup/hon-202-pre-wave2-bdfdd5b`.
- The feature branch was rebased onto `main` at
  `d395d02e5ef4b0cea6a4833646af8a4f5810e3ce` without textual conflicts.
- `git range-diff` reports the pre-rebase and rebased implementation patches as
  exact (`bdfdd5b = de4f328`).
- Focused Vitest passed: 4 files, 261 tests.
- Full Vitest passed before the published-head review: 84 files, 944 tests.
- Workflow Node tests passed: 17 tests.
- Fresh local D1 smoke passed again using synthetic data only; generated
  evidence was refreshed without retaining temporary Wrangler state.
- TypeScript, ESLint, Prettier, brand policy, diff checks, and the strict release
  gate passed; the gate reported 11 pass, 0 manual, and 0 block.
- A fresh latest-main independent review reported no actionable correctness,
  security, or maintainability findings. Its sandbox full-suite attempt passed
  83 files and 941 tests before three unchanged backup CLI tests timed out; the
  host full suite above passed all 84 files and 944 tests.
- Codex review of the first published head then found the auth-request P1. The
  next review found the two proof-defense and audit-console P2 issues described
  above. The following reviews found the durable notification-socket P2 and the
  ordinary-profile-revision P2. The next review found the late refresh-token P1
  described above. The current local remediation passes 84 files and 958 tests,
  fresh local D1 evidence, 17 workflow tests, TypeScript, ESLint, Prettier, brand
  policy, diff checks, and the strict release gate at 11 pass, 0 manual, and 0
  block.

## Remaining Risks

- The current HON-223 source candidate still needs exact-head CI, standard and
  five-axis review, zero unresolved review threads, reviewed-tree equality,
  merge, and merged-main CI.
- HON-223 must close and archive before HON-207; HON-207 must close and archive
  before HON-160. Each transition requires a fresh archived-inclusive readback.
- HON-164 remains blocked by the active HON-160 relation and must not advance
  until a fresh complete relation readback proves that blocker has disappeared.
- Deployment, production behavior, and compatibility levels are unchanged.

## Reusable Follow-up

Use one guarded generation transaction for later credential mutations. Validate
the complete old generation and payload before writes; update credential state,
security stamp, revision, all sessions, and required audit together; reject
unsupported product data before any partial personal-vault mutation; recover by
creating a new forward generation rather than restoring compromised state.
