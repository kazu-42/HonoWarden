# Packet B: HTTP

Objective: expose bulk trust update while keeping login-with-device fail-closed.

Completed:

- Added authenticated `POST /api/devices/update-trust`.
- Accepted upper-camel and lower-camel bulk device key payloads.
- Rejected empty, malformed, oversized, or duplicate-target payloads.
- Returned a device list response through the existing device response builder.
- Added explicit unsupported guards for `/api/auth-requests` and child paths.

Verification:

- `pnpm test -- test/repositories/auth-repository.test.ts test/app.test.ts`
