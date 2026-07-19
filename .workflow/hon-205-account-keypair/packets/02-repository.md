# Packet 02: repository

## Objective

Implement one guarded, atomic D1 account-key initializer with revision advance
and required audit while preserving security stamp and sessions.

## Ownership

- `src/repositories/credential-repository.ts`
- `test/repositories/credential-repository.test.ts`
- `test/support/fake-d1.ts`
- `.workflow/hon-205-account-keypair/results/02-repository.md`

## Verification

- Initialization, stale guard, disabled user, audit rollback, and `RETURNING`
  invariants pass in fake D1 tests.
- No replacement or session-revocation statement is introduced.
