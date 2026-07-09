# Result: Route Audit Coverage

Accepted.

- Added `folder.create`, `folder.update`, `folder.delete`.
- Added `cipher.create`, `cipher.update`, `cipher.delete`,
  `cipher.restore`, `cipher.permanent_delete`.
- Added `attachment.create`, `attachment.delete`.
- Context is limited to result status, IDs, booleans, type, and size metadata.

Rejected.

- Logging encrypted folder names, cipher JSON, attachment keys, file names, R2
  object keys, request bodies, response bodies, tokens, or secrets.
