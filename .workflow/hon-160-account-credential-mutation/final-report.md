# Final Report: HON-160 Account Credential Mutation

Status: AUTH-2A source-ready locally; HON-160 remains In Progress.

## Outcome

HON-160 was decomposed into six one-PR Linear children with nine exact blocking
relations. The first child, HON-202 / AUTH-2A, now has a locally verified
credential-generation primitive and explicit security-stamp rotation route.
The parent and child remain open because GitHub publication, reviewed merge,
main-branch readback, later credential children, deployment, and production
evidence are outside this checkpoint.

## Accepted Results

- Pinned official client/server source defined the observable contract and
  separated existing-account mutation from HON-159 initial-password work.
- Current schema, auth, session, audit, and retention boundaries were audited
  before product edits.
- HON-202 through HON-207 were created under HON-160 with exact project, state,
  priority, archive, description, and dependency readback.
- HON-202 implements bounded current-proof parsing, recent-password
  authorization, monotonic generation rotation, owner-wide session revocation,
  and a required redacted audit row in one guarded D1 batch.
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

## Verification Evidence

- Focused domain/repository: 2 files, 11 tests passed.
- Focused route: 5 tests passed.
- Scheduled retention: 9 tests passed.
- Full Vitest: 80 files, 787 tests passed.
- TypeScript, ESLint, Prettier, brand policy, and diff checks passed.
- Workflow Node tests: 17 tests passed, including managed Linear checkpoint
  tests.
- `results/auth-2a-real-d1-evidence.json` proves fresh migrations, success,
  old-token rejection, owner-wide revocation, relogin/sync, audit rollback,
  cross-account isolation, and one-winner concurrency.
- Canonical and independent Linear decomposition readbacks are exact.
- HON-202 source-ready comment independently read back as one exact managed
  comment: 1667 bytes, SHA-256
  `d6e492c056bee7afbaa0accbf12ba98b666887e254254ef4c810cf8cae8380af`.
- Final independent code review: no actionable findings.
- Focused managed-checkpoint safety and evidence review: no actionable
  findings.

## Remaining Risks

- The diff is uncommitted and unpublished; PR CI and review have not run.
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
