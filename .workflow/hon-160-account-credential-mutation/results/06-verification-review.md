# AUTH-2A verification and review result

Status: P1/P2 remediations passed locally; fresh publication checks pending.

## Host verification

- Complete app tests: 243 tests passed.
- Scheduled-retention tests after the review correction: 9 tests passed.
- Full Vitest suite: 84 files, 947 tests passed.
- `pnpm check`, `pnpm lint`, `pnpm format`, and `pnpm brand:scan` passed.
- Workflow Node tests: 17 tests passed, including deterministic
  managed-checkpoint coverage.
- `git diff --check` passed.

## Real local D1 evidence

A fresh ignored local D1 applied every migration and passed:

- successful rotation with `200` and `Cache-Control: no-store`;
- old access-token rejection;
- all owner device and refresh-token revocation;
- all owner pending/approved auth-request invalidation and encrypted response-key
  clearing;
- stale approved login-with-device rejection at the token endpoint;
- account lock after five invalid current-hash proofs without credential
  mutation;
- rejection of a correct proof while the account gate is locked;
- IP rate limiting at 20 attempts with `Retry-After: 60`;
- unchanged external-user state;
- exactly one required audit row;
- no Worker audit JSON line when `HONOWARDEN_AUDIT_LOGS=false`;
- clean password relogin and sync;
- forced audit-trigger failure with complete batch rollback; and
- two concurrent attempts with exactly one success and one audit row.

The structured evidence is
`results/auth-2a-real-d1-evidence.json`. Temporary Wrangler state was removed,
and no remote database, production resource, real credential, or private vault
data was used.

## Independent review

The first review found one P2 retention inconsistency for mandatory audit rows.
After the scheduled-handler, regression-test, and documentation correction, a
fresh complete-diff review reported no actionable findings and independently
confirmed the credential guard, account-wide revocation, same-batch required
audit, conflict behavior, and rollback invariants.

A Codex review against the first published PR head subsequently found one P1:
an approval created before rotation could still mint a new session afterward.
The remediation adds auth-request invalidation to the same guarded D1 batch.
The next review found two P2 issues: invalid proofs bypassed the existing
login-defense buckets, and successful rotation bypassed the console audit-log
toggle. Both are now covered by route and real-D1 regressions. The current local
head must receive fresh CI and a clean Codex review before merge.

## Linear source-ready checkpoint

The deterministic writer and an independently implemented GraphQL readback
both verified HON-202 as In Progress with one exact managed comment:

- Comment ID: `0c373036-cfb6-4b39-aeae-d397852645ef`
- UTF-8 bytes: `1667`
- SHA-256: `d6e492c056bee7afbaa0accbf12ba98b666887e254254ef4c810cf8cae8380af`
- Readbacks: `results/hon-202-source-ready-readback.json` and
  `results/hon-202-source-ready-independent-readback.json`
- A focused post-sync review recomputed the identity, checked mutation and
  duplicate-comment boundaries, verified artifact consistency, and reported no
  actionable findings.

## Boundary

This evidence proves source readiness only. PR checks, reviewed merge,
main-branch readback, deployment, production operation, and compatibility
promotion remain unclaimed. The current published PR head and CI are superseded
by the locally verified P2 remediation until that exact new head passes CI and
review.
