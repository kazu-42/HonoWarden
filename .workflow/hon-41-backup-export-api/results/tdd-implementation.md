# Result: TDD Implementation

Accepted.

- Added `POST /api/accounts/export` in `src/app.ts`.
- Reused `authenticateRecentPasswordRequest`.
- Reused `listFoldersByUser`, `listCiphersByUser`, and
  `listCipherAttachmentsByUser`.
- Added `backup.export` to the audit event domain.
- Added app tests for owner-scope, recent-auth rejection, sensitive field
  omission, internal R2 object-key omission, and audit event safety.

Rejected.

- No in-memory export throttle was added because it would be unreliable across
  Worker isolates.
- No raw R2 object body export was added.
