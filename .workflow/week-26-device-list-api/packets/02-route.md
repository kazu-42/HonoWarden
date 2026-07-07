# Packet 02: Route

## Objective

Expose read-only device inventory routes through the authenticated API.

## Files

- `src/app.ts`
- `test/app.test.ts`
- `test/support/fake-d1.ts`

## Contract

- `GET /api/devices` requires bearer auth and returns a list wrapper.
- `GET /api/devices/identifier/:identifier` requires bearer auth and returns one
  device or `device_not_found`.
- Responses include current metadata plus `false`/`null` placeholders for
  unsupported trust/key fields.
- Routes do not mutate device or session state.

## Verification

- focused route tests
- TypeScript check
