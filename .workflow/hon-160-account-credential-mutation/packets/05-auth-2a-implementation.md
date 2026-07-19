# Packet 05: AUTH-2A implementation

## Objective

Implement only the credential-generation foundation and explicit
security-stamp rotation owned by HON-202.

## Ownership

- `src/domain/account-credentials.ts`
- `src/repositories/credential-repository.ts`
- `src/app.ts`
- `src/domain/audit.ts`
- focused domain, repository, route, and fake-D1 tests

## Contract

- Accept only a bounded client-derived current authentication proof.
- Require a recent password-authenticated access token and verify the proof
  against the current account row.
- Rotate the security stamp and revision, revoke every active device and
  refresh token for the owner, and persist the required redacted audit event in
  one guarded D1 batch.
- Return a conflict without mutation when the account generation changed.
- Keep password, KDF, account-key, and user-key mutation routes absent.

## TDD sequence

1. Add parser and monotonic-revision tests.
2. Add repository success, conflict, rollback, and concurrency tests.
3. Add route success, invalid-proof, malformed-body, stale-generation, audit
   failure, old-token, and relogin tests.
4. Implement the minimum domain, repository, route, audit, and fake-D1 support.
5. Prove transaction behavior again against a freshly migrated real local D1.

## Output

Source-ready product code and focused tests for HON-202 only. No commit, PR,
merge, deploy, production mutation, or compatibility promotion is part of this
packet.
