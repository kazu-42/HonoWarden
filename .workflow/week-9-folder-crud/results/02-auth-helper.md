# Packet 02 Result: Auth Helper

Accepted:

- Extracted shared protected-route authentication for sync and folder routes.
- The helper checks token secret configuration, bearer token presence, token validity, user existence, disabled state, and security-stamp freshness.
- Existing sync auth tests continue to pass.

Verification:

- `pnpm test test/app.test.ts` passed after helper extraction.

Remaining risks:

- Device-specific authorization is still limited to signed claims; write ownership is enforced by user ID.
