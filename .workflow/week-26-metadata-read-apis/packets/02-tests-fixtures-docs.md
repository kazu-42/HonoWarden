# Packet 02: Tests, Fixtures, And Docs

Objective: Prove and document metadata read API behavior.

Files:

- `test/app.test.ts`
- `compat/fixtures/metadata/*.json`
- `compat/fixture-flows.json`
- `compat/client-matrix.json`
- `test/compat/client-matrix.test.ts`
- `docs/current-state.md`

Do:

- Cover policy and domain route success responses.
- Cover bearer-auth requirement.
- Add `metadata_read` fixture coverage.
- Document remaining non-goals.

Do not:

- Claim live client metadata evidence.
- Edit GitHub Release draft state.

Expected output: Regression tests, fixture matrix, and current-state notes.

Verification: Touched test set, compat tests, and brand scan.
