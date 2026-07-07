# Packet 02: Tests And Docs

Objective: Prove the new guards are explicit and document their current scope.

Files:

- `test/app.test.ts`
- `docs/current-state.md`

Do:

- Extend unsupported-surface tests with representative paths and methods.
- Assert the existing 501 response body and request ID contract.
- Update current-state docs to distinguish route guards from implemented
  functionality.

Do not:

- Add external compatibility brand names to repo-controlled files.
- Change release draft body or GitHub Release state.

Expected output: Regression tests and current-state notes.

Verification: touched test file, docs formatting, and brand scan.
