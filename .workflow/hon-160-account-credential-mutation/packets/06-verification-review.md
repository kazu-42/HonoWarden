# Packet 06: Verification and independent review

## Objective

Verify the complete AUTH-2A diff at unit, route, repository, real-D1, repository,
policy, and independent-review levels before recording a source-ready Linear
checkpoint.

## Required checks

- Focused domain and repository tests.
- Focused route and scheduled-retention regression tests.
- Full Vitest suite, TypeScript, ESLint, Prettier, brand policy, and diff
  whitespace checks.
- Workflow manifest and synchronizer Node tests.
- Fresh local D1 migrations plus success, rollback, concurrency, old-token,
  relogin, cross-account, credential-proof lockout/rate-limit, and audit-toggle
  readback.
- Independent review of the complete uncommitted diff after all fixes.

## Review rule

Every actionable finding must be fixed in the owning earliest slice, covered by
a regression test, and re-reviewed. A review is not clean merely because the
host suite passes.

## Publication boundary

The successful result is `source-ready`, not Done. HON-202 stays In Progress
until commit, PR checks, review, merge, main-branch readback, and exact Linear
closeout have their own evidence.
