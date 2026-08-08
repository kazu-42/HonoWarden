# HON-164 Account Lifecycle Execution Plan

## Decision

HON-164 is split into five finite vertical slices. New findings must map to one
of these slices or demonstrate that the specification is wrong; they do not
create an unbounded sixth implementation lane.

## Source Pins

- HonoWarden base: `6ea46f1b84ca2b51c554bb68469e3f6a6107f567`.
- Official clients: `39f07436ca60e3f25eac47777671754f288a98f1`.
- Official server: `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`.
- Contract: `specs/account-lifecycle.md`.

## Slices

### AUTH-6A Lifecycle foundation

- Add the default-off binding contract, migration, token/deletion state
  machines, mailer port, and secret-safe audit names.
- Prove disabled/misconfigured behavior, token hashing/expiry/supersession, and
  migration constraints before any account mutation route is enabled.
- Size: L.

### AUTH-6B Email identity change

- Implement email-token, email confirmation, verify-email, and
  verify-email-token as a complete vertical slice.
- Reuse current credential proof defenses and credential-generation transaction
  patterns; invalidate sessions and auth requests atomically.
- Size: L. Depends on AUTH-6A.

### AUTH-6C Recoverable account deletion

- Implement authenticated delete plus deprecated POST alias and anonymous
  delete-recover/token compatibility routes.
- Enter recoverable disablement atomically, reject last-owner deletion, and
  extend the operator CLI with before-cutoff recovery.
- Size: L. Depends on AUTH-6A.

### AUTH-6D Irreversible purge saga

- Add dry-run-first R2/D1 purge planning, personal-object inventory, retryable
  progress, organization-data preservation, and opaque tombstoning.
- No remote execution is part of source delivery.
- Size: L. Depends on AUTH-6C.

### AUTH-6E Evidence and closeout

- Add compatibility fixtures, local real-D1/R2 synthetic lifecycle evidence,
  migration/rollback readback, docs, secret scans, full gates, and independent
  review.
- Official-client or deployed-provider evidence remains conservative until a
  separately approved live run exists.
- Size: M. Depends on AUTH-6B, AUTH-6C, and AUTH-6D.

## Critical Path

`AUTH-6A -> AUTH-6B -> AUTH-6C -> AUTH-6D -> AUTH-6E`

The sequence is intentionally serial in this worktree because credential and
deletion mutations share the same user generation and audit invariants. A
later split may run docs/fixture work alongside AUTH-6D, but no two writers may
independently edit the shared lifecycle repository.

## TDD Order

1. Contract and migration tests fail because the feature does not exist.
2. Add the smallest domain state/token implementation.
3. Add D1 repository tests for success, stale generation, rollback, and
   redaction.
4. Add route tests for disabled, misconfigured, invalid, success, and replay.
5. Add real local D1/R2 lifecycle proof before docs claim source support.

## Safety Boundary

- Allowed: source, migrations, tests, local synthetic D1/R2, Linear tracking,
  GitHub publication after review.
- Not allowed in this lane: deployment, provider messages, production secrets,
  production accounts/data, remote deletion, paid services, or third-party
  contact.
