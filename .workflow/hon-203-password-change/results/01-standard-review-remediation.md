# Result 01: Standard Review Remediation

## Accepted

- Treat `null` in an inactive structured or legacy password representation as
  absent while retaining fail-closed behavior for partial and conflicting
  aliases.
- Scope the mandatory password-change audit context to D1-owned session state
  with `d1SessionsRevoked`; Durable Object sockets remain a separate
  post-commit cleanup boundary.

## Rejected

- Do not report the first review as approved. It found two actionable P2 issues.
- Do not weaken dual-representation consistency, KDF/salt generation guards, or
  mandatory audit rollback to accommodate nullable fields.

## Conflict Resolution

The pinned contract allows structured-only and legacy-only requests, while some
serializers retain nullable properties for the inactive representation. A pair
whose supplied aliases are all `null` is therefore absent. A mixed null/non-null
alias pair remains contradictory and invalid.

The D1 transaction can prove device, refresh-token, and active auth-request
invalidation, but it cannot prove post-commit Durable Object socket cleanup.
The audit row now records only the boundary it can prove atomically.

## Verification

- RED: focused domain/app tests failed on both review findings.
- GREEN: focused domain/repository/app suites pass 285 tests.
- Full Vitest: 85 files, 989 tests passed.
- Compatibility: 3 files, 101 tests passed.
- `pnpm check`, `pnpm lint`, `pnpm format`, `pnpm brand:scan`, and
  `git diff --check` passed.
- Release gate: 11 pass, 0 manual, 0 block.
- Real local-D1 lifecycle: 15/15 checks passed with synthetic data.

## Remaining Risk

The remediation head still requires independent standard and five-axis review,
GitHub CI, reviewed merge, main readback, and Linear closeout.
