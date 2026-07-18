# Final Report: HON-160 Account Credential Mutation

Status: AUTH-2A notification-generation remediations verified locally for draft
PR #101; HON-160 remains In Progress.

## Outcome

HON-160 was decomposed into six one-PR Linear children with nine exact blocking
relations. The first child, HON-202 / AUTH-2A, now has a locally verified
credential-generation primitive and explicit security-stamp rotation route.
The parent and child remain open because fresh publication checks, reviewed
merge, main-branch readback, later credential children, deployment, and
production evidence are outside this checkpoint.

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
- Focused, full, policy, real local D1, and independent-review gates passed.

## Rejected Results

- Password, KDF, account-key, and user-key mutation were not bundled into the
  foundation child.
- No title-only Linear issue was adopted; only canonical marker ownership was
  accepted.
- No real account, credential, private vault data, remote database, production
  resource, or browser/simulator session was used.
- API-only evidence was not promoted to official-client compatibility.

## Conflicts Resolved

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

## Verification Evidence

- Complete app and notification-hub tests after all remediations: 256 tests
  passed.
- Scheduled retention: 9 tests passed.
- Current full Vitest: 84 files, 956 tests passed.
- TypeScript, ESLint, Prettier, brand policy, and diff checks passed.
- Workflow Node tests: 17 tests passed, including managed Linear checkpoint
  tests.
- Strict release gate: 11 pass, 0 manual, 0 block.
- `results/auth-2a-real-d1-evidence.json` proves fresh migrations, success,
  old-token and stale-auth-request rejection, owner-wide revocation and
  authorization invalidation, response-key clearing, relogin/sync, audit
  rollback, cross-account isolation, one-winner concurrency, proof lockout and
  IP rate limiting, and disabled console audit emission with mandatory D1
  persistence.
- Canonical and independent Linear decomposition readbacks are exact.
- HON-202 source-ready comment independently read back as one exact managed
  comment: 1667 bytes, SHA-256
  `d6e492c056bee7afbaa0accbf12ba98b666887e254254ef4c810cf8cae8380af`.
- Pre-publication independent code review: no actionable findings at that head.
- Focused managed-checkpoint safety and evidence review: no actionable
  findings.

## Wave 2 Rebase Verification

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
  ordinary-profile-revision P2. The current local remediation passes 84 files
  and 956 tests, fresh local D1 evidence, 17 workflow tests, TypeScript, ESLint,
  Prettier, brand policy, diff checks, and the strict release gate at 11 pass, 0
  manual, and 0 block.

## Remaining Risks

- PR #101's current published head and CI are superseded by the locally verified
  same-stamp notification remediation; the exact remediated head still needs
  commit, push, CI, and a clean review.
- No merge or `main` readback exists, so HON-202 must not move to Done.
- HON-203 through HON-207 remain blocked or pending and own password, KDF,
  keypair, user-key rotation, and official-client lifecycle work.
- Deployment, production behavior, and compatibility levels are unchanged.

## Reusable Follow-up

Use one guarded generation transaction for later credential mutations. Validate
the complete old generation and payload before writes; update credential state,
security stamp, revision, all sessions, and required audit together; reject
unsupported product data before any partial personal-vault mutation; recover by
creating a new forward generation rather than restoring compromised state.
