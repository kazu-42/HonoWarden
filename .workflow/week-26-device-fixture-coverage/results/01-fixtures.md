# Result: 01 Fixtures

## Status

Completed.

## Summary

- Added `compat/fixtures/devices/list-success.json`.
- Added `compat/fixtures/devices/identifier-success.json`.
- Added `compat/fixtures/devices/known-device-success.json`.
- Used root assertion path `$` for the scalar known-device boolean response.

## Notes

- Spark created fixture JSON only. Main integration wired those fixtures into
  the manifest, matrix, and route replay tests.
