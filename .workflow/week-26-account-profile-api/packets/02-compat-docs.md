# Packet 02: Compatibility And Docs

Objective: Cover the account profile contract in tests, fixtures, and current
state.

Files:

- `test/app.test.ts`
- `compat/fixtures/accounts/profile-success.json`
- `compat/fixture-flows.json`
- `compat/client-matrix.json`
- `test/compat/client-matrix.test.ts`
- `docs/current-state.md`

Do:

- Add HTTP test coverage for account profile.
- Add `account_profile` fixture coverage.
- Keep compatibility evidence conservative.
- Document the read-only endpoint and missing mutation/lifecycle flows.

Do not:

- Claim live client profile evidence.
- Edit GitHub Release draft state.

Expected output: Fixture-backed compatibility contract and current-state notes.

Verification: App tests, compat tests, and brand scan.
