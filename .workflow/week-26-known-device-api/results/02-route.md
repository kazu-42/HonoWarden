# Result 02: Route

## Accepted

- Added anonymous `GET /api/devices/knowndevice`.
- Added base64url email header parsing and device identifier validation.
- Valid lookup misses return boolean `false`.
- Malformed headers return `400 invalid_request`.
- D1 lookup failures return `503 database_unavailable`.

## Verification

- RED was observed as route 404 before implementation.
- `pnpm test -- test/app.test.ts -t "known active device|known-device"` passed.
- `pnpm check` passed after route implementation.
