# Result: api-routes

Accepted.

- Replaced cipher-scoped attachment unsupported routes with authenticated
  upload, download, and delete routes.
- Kept top-level `/api/attachments` as explicit unsupported alpha surface.
- Generated R2 keys as `attachments/<uuid>` without user, cipher, email, or
  filename material.
- Injected D1 attachment metadata into cipher read/list/sync responses without
  exposing internal R2 object keys.
- Added in-memory fake R2 support and expanded fake D1 attachment behavior.

Verification:

- `pnpm exec vitest run test/app.test.ts` passed as part of the targeted suite.
- `pnpm check` passed.
