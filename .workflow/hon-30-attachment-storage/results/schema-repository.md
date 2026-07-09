# Result: schema-repository

Accepted.

- Added `cipher_attachments` with owner/cipher foreign keys, opaque unique
  `object_key`, encrypted filename/key metadata, size, content type, and
  revision timestamps.
- Added create/list/find/delete repository operations with `user_id`,
  `cipher_id`, and attachment `id` predicates where applicable.
- Added migration and repository tests.

Verification:

- `pnpm exec vitest run test/migrations.test.ts test/repositories/attachment-repository.test.ts`
  passed: 3 files, 20 tests.
