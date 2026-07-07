# Packet 01: Repositories And Routes

Objective: Add read-only direct folder and cipher APIs.

Files:

- `src/repositories/folder-repository.ts`
- `src/repositories/cipher-repository.ts`
- `src/app.ts`
- `test/support/fake-d1.ts`

Do:

- Add owner-scoped single-row lookup repository functions.
- Add authenticated folder and cipher list/get routes.
- Reuse existing response builders.
- Keep folders active-only and ciphers active-or-trashed.

Do not:

- Add pagination, attachment reads, collection reads, or shared-vault behavior.
- Touch external release or deployment state.

Expected output: Read-only API implementation.

Verification: Repository tests, HTTP tests, and typecheck.
