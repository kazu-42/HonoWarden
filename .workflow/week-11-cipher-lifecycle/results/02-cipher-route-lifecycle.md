# Packet 02 Result: Cipher Route Lifecycle

Accepted:

- Added `PUT /api/ciphers/:id`.
- Added `DELETE /api/ciphers/:id`.
- Added `PUT /api/ciphers/:id/restore`.
- Added `DELETE /api/ciphers/:id/delete`.
- Added folder ownership check on cipher update.
- Added stable `cipher_not_found` and `cipher_folder_not_found` route responses.

Verification:

- `pnpm test test/app.test.ts` passed with 47 tests.
- `pnpm test` passed with 12 files and 107 tests.

Remaining risks:

- Live client confirmation is needed for exact lifecycle response compatibility.
