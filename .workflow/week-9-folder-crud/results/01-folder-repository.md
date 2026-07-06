# Packet 01 Result: Folder Repository

Accepted:

- Added owner-scoped folder list, create, update, and soft delete repository functions.
- Folder names are passed through as opaque encrypted strings and stored in `encrypted_name`.
- Update and delete require `id`, `user_id`, and `deleted_at IS NULL`.

Verification:

- `pnpm test test/repositories/folder-repository.test.ts` passed with 6 tests.
- `pnpm check` passed after repository integration.

Remaining risks:

- Folder revision conflict detection is not implemented yet.
