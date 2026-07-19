# Packet 04 result: evidence and review remediation

## Integrated evidence

- Focused account-key/bootstrap/repository/app suite: 4 files, 347 tests.
- Full repository suite: 89 files, 1,100 tests.
- Compatibility suite: 3 files, 105 tests.
- Real local D1 lifecycle: passed initialize, read, replay, conflict,
  concurrent exact retry, both batch rollback orders, restart, preserved
  sessions, and disabled-route state equivalence.
- TypeScript, ESLint, Prettier, brand scan, dependency audit, Cloudflare type
  generation, diff check, release gate 11/11, workflow verifier, and byte-exact
  Linear plan readback passed.

## Standard review findings

The first full-branch review found one P2: an account without a wrapped user key
could consume the one-time pair slot and receive `key: null`. Remediation added
an application precondition, complete-projection fail-close, and identical
non-empty `user_key` guards to the audit reservation and user update.

The second full-branch review found three P2 issues:

- bootstrap accepted a partial account-key pair and could create an account with
  no supported recovery path
- profile update validated the new complete-only projection after committing the
  user update
- backup export persisted success before constructing the projection and could
  then emit a contradictory failure audit

Remediation constrains bootstrap to a missing pair or a complete pair with its
wrapped user key, preflights profile projection before UPDATE, and builds backup
output before success audit persistence. TDD reproduced all three failures and
then passed.

The third full-branch review found two P2 operational gaps:

- the optional global quota could touch D1 and replace the disabled route's 501
  before route-level flag handling
- broad route catches returned generic 503 for corrupt projections without a
  redacted incident signal

Remediation adds a disabled account-key quota bypass and a typed projection
error reported with request ID plus a bounded reason at every affected catch.
TDD reproduced both failures, then the focused suite passed 347 tests.

## Pending publication gates

- standard review on the resulting exact commit
- separate five-axis review on the same exact commit
- PR head CI, unresolved-thread readback, admin squash merge, and exact-main CI
- Linear Done/archive, HON-206 queue advancement, and worktree cleanup

No production deployment, route activation, remote D1 mutation, real-account
key change, compatibility promotion, or secret rotation occurred.
