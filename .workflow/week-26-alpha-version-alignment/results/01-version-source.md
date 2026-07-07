# Result 01: Version Source

## Accepted

- Added a runtime `serviceVersion` constant with value `0.1.0-alpha`.
- Set `package.json` version to `0.1.0-alpha`.
- Added release-doc coverage so package version drift fails tests.

## Verification

- `pnpm test -- test/release-docs.test.ts -t "package version"` passed.
- `pnpm check` passed.
