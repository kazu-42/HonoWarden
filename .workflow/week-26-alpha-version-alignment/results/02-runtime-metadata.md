# Result 02: Runtime Metadata

## Accepted

- Root service metadata now includes `version: 0.1.0-alpha`.
- Health metadata reports `0.1.0-alpha`.
- Server config metadata reports `0.1.0-alpha`.
- Root status remains `pre-alpha` to avoid overclaiming before a tag exists.

## Verification

- `pnpm test -- test/app.test.ts -t "service metadata|health response|server config"` passed.
