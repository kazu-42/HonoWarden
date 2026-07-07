# Packet 02: Route

## Objective

Expose anonymous known-device lookup through the API.

## Files

- `src/app.ts`
- `test/app.test.ts`
- `test/support/fake-d1.ts`

## Contract

- `GET /api/devices/knowndevice` accepts `X-Request-Email` and
  `X-Device-Identifier` headers.
- Email header is base64url decoded and normalized.
- Valid misses return boolean `false`.
- Missing or malformed headers return `400 invalid_request`.
- D1 errors return `503 database_unavailable`.

## Verification

- focused route tests
