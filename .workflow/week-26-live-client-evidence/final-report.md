# Week 26 Live Client Evidence Final Report

## Result

Completed local synthetic CLI live smoke for `2026.6.0`.

## Evidence

- `docs/release/live-client-evidence.md`
- `compat/client-matrix.json`
- `pnpm release:gate` now reports `ready` with `10` passing checks and `0`
  blocking checks.

## Implemented Compatibility Fixes

- Added `/identity/accounts/prelogin/password` as a prelogin alias.
- Added `/api/accounts/revision-date`.
- Returned account key metadata and master-password unlock data in token and
  sync responses.
- Accepted device metadata from password-grant form fields, while preserving
  existing header support.

## Verification

- CLI login exit code: `0`
- CLI session key length: `88`
- CLI sync exit code: `0`
- CLI sync stdout: `Syncing complete.`
- Non-TLS stderr lines: `0`
- Local targeted tests passed.
- `pnpm release:gate` passed.

## Remaining Limits

The live smoke covers only the CLI config, password login, empty sync, and
revision lookup path. Other client surfaces and broader mutation flows remain
fixture-only until their own live evidence is captured.
