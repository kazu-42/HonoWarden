# Packet 02 Result: Route Device Revoke

Accepted:

- Added authenticated `POST /api/devices/:id/revoke`.
- Protected auth context now returns the verified access-token device identifier.
- The current device cannot revoke itself through this route.
- Missing, cross-user, and already revoked device targets return `404 device_not_found`.

Verification:

- Targeted app tests passed.
- Fake D1 can simulate successful and missing device revoke writes.

Remaining risks:

- Device list and metadata update endpoints are still deferred.
