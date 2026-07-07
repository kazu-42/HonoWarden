# Packet 02: Tests, Fixtures, And Docs

Objective: Prove and document the direct read API contract.

Files:

- `test/app.test.ts`
- `test/repositories/folder-repository.test.ts`
- `test/repositories/cipher-repository.test.ts`
- `compat/fixtures/folders/*.json`
- `compat/fixtures/ciphers/*.json`
- `compat/fixture-flows.json`
- `compat/client-matrix.json`
- `test/compat/client-matrix.test.ts`
- `docs/current-state.md`

Do:

- Cover list and get success paths.
- Cover folder deleted-row filtering and cross-user 404s.
- Cover cipher trashed-row reads and cross-user 404s.
- Add `direct_read` fixture coverage.
- Document remaining non-goals.

Do not:

- Claim live client direct-read evidence.
- Edit GitHub Release draft state.

Expected output: Regression tests, fixture matrix, and current-state notes.

Verification: Touched test set, compat tests, and brand scan.
