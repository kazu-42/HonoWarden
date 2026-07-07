# Packet 02: Tests, Fixtures, And Docs

Objective: Prove and document collection metadata read behavior.

Files:

- `test/app.test.ts`
- `compat/fixtures/metadata/collections-list-success.json`
- `compat/fixtures/metadata/collection-get-not-found.json`
- `compat/fixture-flows.json`
- `docs/current-state.md`

Do:

- Cover authenticated collection list success.
- Cover authenticated collection lookup not-found.
- Cover bearer-auth requirement.
- Keep mutation route unsupported tests passing.
- Add fixture coverage and docs.

Do not:

- Claim live client collection metadata evidence.
- Edit GitHub Release draft state.

Expected output: Regression tests, fixture matrix, and current-state notes.

Verification: Touched app and compat tests plus brand scan.
