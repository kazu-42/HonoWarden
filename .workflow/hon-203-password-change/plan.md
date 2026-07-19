# HON-203 password verification and change

## Goal

Implement the pinned upstream-compatible current-password verification and
existing-account master-password change surfaces without exposing plaintext
passwords or weakening HonoWarden's credential-generation boundary.

## Success Criteria

- `POST /api/accounts/verify-password` accepts only the pinned structured proof
  variants and applies the existing credential-proof defenses.
- `POST /api/accounts/password` atomically replaces the authentication hash and
  opaque wrapped user key, advances revision/security stamp, revokes every
  session and active auth request, and persists the mandatory audit event.
- Authentication/unlock salt and KDF parameters remain unchanged; callers
  cannot change the credential generation's KDF policy through this route.
- Non-empty password hints are rejected before mutation rather than silently
  discarded.
- Invalid, stale, oversized, mixed-alias, and database-failure cases preserve
  the old credential generation and sessions.
- A synthetic real-D1 lifecycle proves old-password rejection, old-token and
  refresh-token rejection, new-password login, unchanged KDF/unlock metadata,
  and unchanged encrypted vault data.
- Exact-head CI, independent Codex review, five-axis review, PR merge, main CI,
  and Linear readback all complete before closeout.

## Current Context

- Base: `main` at `166398b73ab76036a275ebbf77291320a8b9679b`.
- HON-202 established generation-guarded D1 batch rotation for security stamp,
  revision, session/auth-request invalidation, and mandatory audit persistence.
- HonoWarden stores only the client-derived authentication hash and opaque
  encrypted user key; the server cannot and must not derive them from a master
  password.
- Official contract evidence is pinned to the repository's upstream
  server/client `v2026.6.1` compatibility baseline.

## Constraints

- Synthetic identities and vault material only. No production deployment,
  production D1 write, real-user mutation, or secret rotation in this workflow.
- Preserve published API aliases only when confirmed by the pinned official
  client/server sources; conflicting aliases fail closed.
- Keep KDF fields and email-derived salt stable during password change.
- Bound every opaque credential value before any repository operation.
- Infrastructure and audit failures are visible and fail loudly.

## Risks

- A partial credential transition could permanently lock a user out or leave a
  stale session active; all D1-owned changes therefore share one guarded batch.
- Durable notification sockets are outside the D1 transaction; the route must
  preflight the binding and report any post-commit cleanup failure explicitly.
- Over-broad legacy aliases can create ambiguous proofs; mixed or conflicting
  representations are rejected.
- Fake-D1 success alone can hide SQL/runtime drift; a local Wrangler D1
  lifecycle is required in addition to unit and route tests.

## Approval Required

No additional approval is required for local implementation, GitHub PR review,
or an exact-head `--admin` merge after all gates pass. Production rollout and
real-user credential changes remain out of scope and require a separate gate.

## Work Packets

1. Pin the official server/client request and response contracts.
2. Map the existing credential, session, audit, and notification boundaries.
3. Implement domain parsing, guarded repository mutation, and routes via TDD.
4. Prove the lifecycle against a real local D1 database and synthetic vault.
5. Reconcile capability/security/compatibility documentation and evidence.
6. Run exact-head Codex and five-axis reviews, then integrate and close out.

## Integration Policy

- Integrate only evidence tied to the exact reviewed commit.
- Do not weaken tests or hide partial failures to make a gate pass.
- Rebase or merge latest `main` before final review if the base moves, then
  rerun all candidate checks.
- Merge only when the PR tree matches the reviewed candidate tree.

## Verification

- Focused red/green tests for domain, repository, route, and local-D1 lifecycle.
- Full `pnpm test`, typecheck, lint, format, compatibility, migration, audit,
  generated-types, and Wrangler staging/production dry-run gates.
- Exact-head GitHub Actions and post-merge `main` Actions success.
- GitHub PR state and Linear issue/comment/archive readback.

## Reusable Artifacts

- Pinned upstream contract note.
- Synthetic password-change lifecycle script and evidence.
- Exact-head independent review and five-axis review reports.
