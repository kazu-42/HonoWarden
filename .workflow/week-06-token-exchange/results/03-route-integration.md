# Packet 03 Result: Route Integration

Accepted:

- Added `POST /identity/connect/token` for password grant.
- Missing token secret fails closed with `503`.
- Missing device identifier fails with stable invalid request response.
- Unknown user and wrong password share the same invalid grant response.
- Successful grant returns fixture-compatible token response fields.

Verification:

- `pnpm test test/app.test.ts` passed with 19 tests.
- `pnpm check` passed after narrowing token error result types.

Remaining risks:

- Local dev server does not have `HONOWARDEN_TOKEN_SECRET`, so success path is currently covered by route tests rather than live local smoke.
