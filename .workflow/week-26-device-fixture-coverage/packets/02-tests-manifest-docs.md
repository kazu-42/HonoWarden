# Packet 02: Tests Manifest Docs

## Objective

Wire device fixtures into compatibility flow coverage and route replay.

## Context

The new known-device fixture returns a scalar boolean, so fixture assertion
helpers need root path support.

## Files / Sources

- `compat/fixture-flows.json`
- `compat/client-matrix.json`
- `test/compat/compat-fixtures.test.ts`
- `test/compat/fixture-replay-support.ts`
- `test/compat/fixture-route-replay.test.ts`
- `test/compat/client-matrix.test.ts`
- `docs/current-state.md`
- `docs/compatibility-matrix.md`

## Ownership

Main agent.

## Do

- Add `device_read` and `known_device_preflight` fixture flows.
- Add both flows to each client matrix row.
- Add route replay seed coverage for device list, identifier lookup, and
  known-device preflight.
- Update documentation.

## Do Not

- Promote live client rows.
- Add device mutation behavior.

## Expected Output

- CI-covered fixture and route replay coverage for implemented device read and
  known-device preflight routes.

## Verification

- Targeted compatibility tests pass.
